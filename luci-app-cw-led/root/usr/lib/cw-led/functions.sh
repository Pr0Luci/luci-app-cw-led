# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 Pr0Luci
# Shared helpers for the daemon and the rpcd plugin. Plain functions, nothing
# runs when this file is sourced.

# cw_led_in_window START END [NOW_HHMM]
#   Returns 0 when "now" is inside the window, 1 otherwise.
#   Times are HH:MM (HHMM for the optional NOW argument).
#   A window with start > end (e.g. 22:30-06:00) wraps past midnight.
#   start == end is an empty window: always outside.
cw_led_in_window() {
	local s e n
	s=$(printf '%s' "$1" | tr -d ':')
	e=$(printf '%s' "$2" | tr -d ':')
	n="${3:-$(date +%H%M)}"
	case "${s}${e}${n}" in
	''|*[!0-9]*) return 1 ;;
	esac
	[ "${#s}" -eq 4 ] && [ "${#e}" -eq 4 ] && [ "${#n}" -eq 4 ] || return 1
	# BusyBox test reads "0830" as decimal 830, no octal surprise
	[ "$s" -eq "$e" ] && return 1
	if [ "$s" -lt "$e" ]; then
		[ "$n" -ge "$s" ] && [ "$n" -lt "$e" ]
		return $?
	fi
	[ "$n" -ge "$s" ] || [ "$n" -lt "$e" ]
	return $?
}

# cw_wifi_any_up
#   Returns 0 if any wireless netdev is up. Reads operstate, so it does not
#   depend on the driver: ath11k on ipq807x ignores the mac80211 phyXradio LED
#   triggers, which is why green:wifi has to be driven by the daemon.
cw_wifi_any_up() {
	local n ifc st
	for n in /sys/class/net/*/phy80211; do
		[ -e "$n" ] || continue
		ifc=$(basename "$(dirname "$n")")
		st=$(cat "/sys/class/net/$ifc/operstate" 2>/dev/null)
		[ "$st" = "up" ] && return 0
	done
	return 1
}

# cw_wifi_first_iface
#   Prints the first wireless netdev (e.g. phy0-ap0), or nothing.
cw_wifi_first_iface() {
	local n ifc
	for n in /sys/class/net/*/phy80211; do
		[ -e "$n" ] || continue
		ifc=$(basename "$(dirname "$n")")
		printf '%s\n' "$ifc"
		return 0
	done
}

# cw_led_tricolor_color 5g|signal
#   Prints what the three-LED group shows right now:
#     blue|green|red   that member is lit
#     <c>-flash        that member runs the kernel 'timer' trigger. This is
#                      checked before brightness so a sample taken mid-blink
#                      does not report the flashing lamp as off.
#     off              nothing lit (or more than one lit)
cw_led_tricolor_color() {
	local c b trig lit="" n=0
	for c in blue green red; do
		trig=$(sed -n 's/.*\[\([^]]*\)\].*/\1/p' "/sys/class/leds/$c:$1/trigger" 2>/dev/null)
		if [ "$trig" = "timer" ]; then
			printf '%s-flash\n' "$c"
			return 0
		fi
		b=$(cat "/sys/class/leds/$c:$1/brightness" 2>/dev/null)
		if [ "$b" = "1" ]; then
			lit="$c"
			n=$((n + 1))
		fi
	done
	if [ "$n" -eq 1 ]; then
		printf '%s\n' "$lit"
	else
		printf 'off\n'
	fi
}

# cw_valid_host HOST
#   Returns 0 when HOST can be passed to ping/curl as a bare host: non-empty,
#   only [A-Za-z0-9._:-], and not starting with '-' (busybox ping would take
#   that as an option).
cw_valid_host() {
	case "$1" in
	'' | -* | *[!A-Za-z0-9._:-]*) return 1 ;;
	esac
	return 0
}
