# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 Pr0Luci
# Modem AT layer. Talks to the Quectel AT port directly with plain BusyBox sh
# (fd + read -t); the firmware has no microcom, timeout or flock applets.
# Command syntax is from the public Quectel RG50xQ AT manual.
#
# Entry points:
#   cw_at_query CMD            one AT command, response lines on stdout
#   cw_modem_poll              sets M_RAT (sa|nsa|lte|3g|none), M_RSRP, M_CSQ,
#                              M_REG, M_REGSTAT (raw CEREG stat), M_SIM (ok|fail)
#   cw_modem_probe_port        find a responsive AT port, updates CW_AT_PORT
#   cw_modem_parse_qeng TEXT   parsers, usable without hardware
#   cw_modem_parse_csq TEXT
#   cw_modem_parse_cpin TEXT

CW_AT_PORT="${CW_AT_PORT:-/dev/ttyUSB3}"
CW_AT_TIMEOUT="${CW_AT_TIMEOUT:-3}"
CW_AT_LOCK="${CW_AT_LOCK:-/var/lock/cw-led-at.lock}"
CW_AT_CR=$(printf '\r')

# Serialize our own processes (daemon vs rpcd plugin). The port can't be locked
# against other software, so we just keep the polling rate low.
cw_at_lock() {
	local tries=0 pid ts now age max
	max=$((CW_AT_TIMEOUT * 3))
	[ "$max" -ge 15 ] || max=15
	while ! mkdir "$CW_AT_LOCK" 2>/dev/null; do
		pid=$(cat "$CW_AT_LOCK/pid" 2>/dev/null)
		ts=$(cat "$CW_AT_LOCK/ts" 2>/dev/null)
		now=$(date +%s)
		case "$ts" in '' | *[!0-9]*) age=$((max + 1)) ;; *) age=$((now - ts)) ;; esac
		# take over a stale lock: the holder is gone, or the lock is older than
		# any query could run (holder was killed, pid may have been reused)
		if { [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; } || [ "$age" -gt "$max" ]; then
			rm -rf "$CW_AT_LOCK"
			continue
		fi
		tries=$((tries + 1))
		[ "$tries" -ge 3 ] && return 1
		sleep 1
	done
	echo "$$" > "$CW_AT_LOCK/pid"
	date +%s > "$CW_AT_LOCK/ts"
	# if someone else re-created the lock between our rm and mkdir, the pid
	# file is not ours: back off
	if [ "$(cat "$CW_AT_LOCK/pid" 2>/dev/null)" != "$$" ]; then
		return 1
	fi
	return 0
}

cw_at_unlock() {
	rm -rf "$CW_AT_LOCK"
}

cw_at_query() {
	local out to="$CW_AT_TIMEOUT"
	# read -t 0 doesn't block and would make every query fail
	case "$to" in '' | *[!0-9]* | 0) to=3 ;; esac
	[ -c "$CW_AT_PORT" ] || return 1
	cw_at_lock || return 1
	out=$(
		{
			exec 3<>"$CW_AT_PORT" || exit 1
			printf '%s\r' "$1" >&3
			n=0
			while [ "$n" -lt 24 ] && IFS= read -r -t "$to" line <&3; do
				line=${line%"$CW_AT_CR"}
				n=$((n + 1))
				# skip the echoed command (echo may be on) and blank lines
				[ "$line" = "$1" ] && continue
				[ -z "$line" ] && continue
				printf '%s\n' "$line"
				# the leading "(" keeps case parseable inside $(...)
				case "$line" in
				(OK | ERROR* | "+CME ERROR"* | "+CMS ERROR"*) break ;;
				esac
			done
			exec 3<&- 3>&-
		} 2>/dev/null
	)
	cw_at_unlock
	[ -n "$out" ] || return 1
	printf '%s\n' "$out"
}

# First comma-separated field that looks like an RSRP value (dBm in [-140,-44]).
# The field position differs between the LTE, NR5G-NSA and NR5G-SA replies, but
# RSRP is always the first in-range negative integer on the serving line: RSRQ
# and SINR are outside the range, TAC and ARFCN are positive.
cw_modem_rsrp_from_line() {
	local IFS=',' f
	for f in $1; do
		case "$f" in
		-[0-9]*)
			case "${f#-}" in *[!0-9]*) continue ;; esac
			if [ "$f" -le -44 ] && [ "$f" -ge -140 ]; then
				printf '%s\n' "$f"
				return 0
			fi
			;;
		esac
	done
	return 1
}

# Parse the AT+QENG="servingcell" reply. Sets M_RAT (sa|nsa|lte|3g|none) and
# M_RSRP. The RSRP comes from the line that matches the access technology:
#   SA  -> NR5G-SA line
#   NSA -> the LTE anchor line (what the user actually connects through)
#   LTE -> LTE line
#   3G  -> WCDMA line (RSCP)
#   no serving line -> none
cw_modem_parse_qeng() {
	local sa_line nsa_line lte_line wcdma_line anchor
	M_RAT=""
	M_RSRP=""
	sa_line=$(printf '%s\n' "$1" | grep -E -m1 '"NR5G-SA"')
	nsa_line=$(printf '%s\n' "$1" | grep -E -m1 '"NR5G-NSA"')
	lte_line=$(printf '%s\n' "$1" | grep -F -m1 '"LTE"')
	wcdma_line=$(printf '%s\n' "$1" | grep -E -m1 '"WCDMA"|"UMTS"|"TD-SCDMA"')
	if [ -n "$sa_line" ]; then
		M_RAT="sa"; anchor="$sa_line"
	elif [ -n "$nsa_line" ]; then
		M_RAT="nsa"; anchor="${lte_line:-$nsa_line}"
	elif [ -n "$lte_line" ]; then
		M_RAT="lte"; anchor="$lte_line"
	elif [ -n "$wcdma_line" ]; then
		M_RAT="3g"; anchor="$wcdma_line"
	else
		printf '%s\n' "$1" | grep -F -q '+QENG' && M_RAT="none"
		return 0
	fi
	M_RSRP=$(cw_modem_rsrp_from_line "$anchor") || M_RSRP=""
	return 0
}

# Parse the AT+CSQ reply. Sets M_CSQ (0..31; 99 or garbage leaves it empty).
cw_modem_parse_csq() {
	local csq
	M_CSQ=""
	csq=$(printf '%s\n' "$1" | sed -n 's/^+CSQ: *\([0-9][0-9]*\),.*/\1/p' | head -1)
	if [ -n "$csq" ] && [ "$csq" -ge 0 ] && [ "$csq" -le 31 ]; then
		M_CSQ=$csq
	fi
	return 0
}

# Parse the AT+CPIN? reply. Sets M_SIM (ok|fail, empty = can't tell).
# "+CPIN: READY" is ok. Any other +CPIN state (SIM PIN, PUK, ...) or a SIM
# error (10 not inserted, 13 failure, 15 wrong card) is a SIM fault. A plain
# ERROR leaves it empty, since it can just be another reader on the port.
cw_modem_parse_cpin() {
	M_SIM=""
	case "$1" in
	*"+CPIN: READY"*) M_SIM=ok ;;
	*"+CPIN:"*) M_SIM=fail ;;
	*"+CME ERROR: 10"* | *"+CME ERROR: 13"* | *"+CME ERROR: 15"*) M_SIM=fail ;;
	esac
	return 0
}

# One poll. Sets M_RAT M_RSRP M_CSQ M_REG M_REGSTAT M_SIM.
# Returns 0 if at least one AT query was answered, 1 if none was (port
# missing, busy or silent); the caller decides when that turns the LEDs off.
cw_modem_poll() {
	local resp ok=0 stat
	M_RAT=""
	M_RSRP=""
	M_CSQ=""
	M_REG=""
	M_REGSTAT=""
	M_SIM=""
	if resp=$(cw_at_query 'AT+QENG="servingcell"'); then
		ok=1
		cw_modem_parse_qeng "$resp"
	fi
	if [ -z "$M_RSRP" ]; then
		if resp=$(cw_at_query 'AT+CSQ'); then
			ok=1
			cw_modem_parse_csq "$resp"
		fi
	fi
	if [ -n "$M_RAT" ] && [ "$M_RAT" != "none" ]; then
		M_REG=1
	elif [ "$ok" = 1 ]; then
		if resp=$(cw_at_query 'AT+CEREG?'); then
			stat=$(printf '%s\n' "$resp" |
				sed -n 's/^+CEREG: *[0-9][0-9]*, *\([0-9][0-9]*\).*/\1/p' | head -1)
			M_REGSTAT="$stat"
			case "$stat" in
			1 | 5) M_REG=1 ;;
			'') M_REG="" ;;
			*) M_REG=0 ;;
			esac
		fi
		# Not registered: check the SIM so the signal LED can tell a SIM fault
		# from "connecting" from "no service". Only done when something is
		# wrong, to keep normal AT traffic low.
		if [ "$M_REG" != 1 ]; then
			if resp=$(cw_at_query 'AT+CPIN?'); then
				cw_modem_parse_cpin "$resp"
			fi
		fi
	fi
	[ "$ok" = 1 ]
}

# Find a responsive AT port: the configured one first, then the usual Quectel
# ttyUSB candidates. Updates CW_AT_PORT on success (runtime only, UCI is never
# rewritten).
cw_modem_probe_port() {
	local p tried="" configured="$CW_AT_PORT"
	for p in "$configured" /dev/ttyUSB3 /dev/ttyUSB2 /dev/ttyUSB1 /dev/ttyUSB0; do
		[ -c "$p" ] || continue
		case " $tried " in *" $p "*) continue ;; esac
		tried="$tried $p"
		CW_AT_PORT=$p
		if cw_at_query 'AT' | grep -q '^OK$'; then
			return 0
		fi
	done
	CW_AT_PORT=$configured
	return 1
}
