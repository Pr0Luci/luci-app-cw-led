'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require uci';

/*
 * SPDX-License-Identifier: GPL-2.0-only
 * Copyright (C) 2026 Pr0Luci
 *
 * LED management page for the AW1000: a live status card plus one card per
 * form section, toggle switches, a value chip on the slider and a signal scale.
 * The extras are null-safe and wrapped in try/catch so they can't break
 * m.render(). The form.Map logic and the .cbi-* DOM are left alone; the styling
 * only hooks onto .cw-led-page and .cw-led-map.
 */
var callStatus = rpc.declare({
	object: 'luci.cw-led',
	method: 'status',
	expect: { }
});

var callOptions = rpc.declare({
	object: 'luci.cw-led',
	method: 'options',
	expect: { }
});

function addChoices(o, list) {
	(list || []).forEach(function(v) { o.value(v); });
}

/* The card layout and the toggle switches are made for the Apex theme; other
 * themes keep the stock CBI form (the live status card works in any theme).
 * The theme name comes from L.env.media, set by the luci-base header template. */
function isApexTheme() {
	var media = String(L.env.media || '').replace(/\/+$/, '');

	return media.slice(media.lastIndexOf('/') + 1) === 'apex';
}

/* LED colour keys. The colours are CSS custom properties (--cl-g/b/r/am/w),
 * set per colour scheme below, so lamps, labels and the scale follow the theme. */
var LED_KEYS = [ 'blue', 'green', 'red' ];

/* Namespaced styles, injected once. They use the Apex theme's --ax-* variables
 * with neutral fallbacks, so the page still looks fine in other themes. */
var CW_CSS = [
	/* ---- tokens ---- */
	'.cw-led-page{--cl-card:var(--ax-card,Canvas);--cl-sub:var(--ax-bg,rgba(128,128,128,.1));--cl-hair:var(--ax-border,rgba(128,128,128,.32));',
	'--cl-field:var(--ax-track,rgba(128,128,128,.75));--cl-trk:var(--ax-input-bg,Canvas);--cl-fg:var(--ax-fg,CanvasText);--cl-muted:var(--ax-muted,rgba(128,128,128,1));',
	'--cl-ink:var(--ax-accent-text,#0f766e);--cl-acc:var(--ax-accent,#14b8a6);--cl-accink:#0b1f1d;--cl-tint:var(--ax-accent-dim,rgba(20,184,166,.14));',
	'--cl-mono:var(--ax-mono,ui-monospace,monospace);--cl-r:var(--ax-r,3px);--cl-h:40px;',
	'--cl-g:#34d399;--cl-b:#60a5fa;--cl-r2:#f87171;--cl-am:#fbbf24;--cl-w:#e6eaee;--cl-off:#0e1114;display:flex;flex-direction:column;gap:16px;color:var(--cl-fg)}',
	'@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .cw-led-page{--cl-g:#2e8b57;--cl-b:#2563c9;--cl-r2:#b91c1c;--cl-am:#b7791f;--cl-w:#fff;--cl-off:#f3f4f6}}',
	':root[data-theme="light"] .cw-led-page{--cl-g:#2e8b57;--cl-b:#2563c9;--cl-r2:#b91c1c;--cl-am:#b7791f;--cl-w:#fff;--cl-off:#f3f4f6}',
	'@media (max-width:700px){.cw-led-page{--cl-h:44px}}',
	'.cw-c-green{--c:var(--cl-g)}.cw-c-blue{--c:var(--cl-b)}.cw-c-red{--c:var(--cl-r2)}.cw-c-amber{--c:var(--cl-am)}.cw-c-white{--c:var(--cl-w)}',

	/* ---- live status card ---- */
	'.cw-live{background:var(--cl-card);border:1px solid var(--cl-hair);border-radius:var(--cl-r);padding:14px 16px 16px;display:flex;flex-direction:column;gap:14px}',
	'.cw-chips{display:flex;gap:8px;flex-wrap:wrap}',
	'.cw-chip{display:inline-flex;gap:8px;align-items:center;border:1px solid var(--cl-hair);background:var(--cl-sub);border-radius:var(--cl-r);padding:5px 10px;font:500 12px var(--cl-mono)}',
	'.cw-chip i{width:8px;height:8px;border-radius:50%;background:var(--c,var(--cl-g))}.cw-chip.idle i{background:transparent;border:1.5px solid var(--cl-field)}',
	'.cw-leds{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}',
	'@media (max-width:700px){.cw-leds{grid-template-columns:repeat(3,minmax(0,1fr))}}',
	'.cw-led{display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--cl-sub);border:1px solid var(--cl-hair);border-radius:var(--cl-r);padding:14px 6px 10px;text-align:center}',
	'.cw-lamp{width:38px;height:16px;border-radius:4px;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}',
	'.cw-led.cw-c-white .cw-lamp{border:1px solid var(--cl-field)}',
	'.cw-led.off .cw-lamp{background:var(--cl-off);border:1px solid var(--cl-field);box-shadow:none}',
	'.cw-n{font:400 12px var(--cl-mono);color:var(--cl-muted);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
	'.cw-s{font-size:13px;font-weight:600;color:color-mix(in srgb,var(--c) 62%,var(--cl-fg))}.cw-led.off .cw-s{color:var(--cl-muted)}',
	'.cw-dots{display:flex;gap:4px;height:8px}.cw-dots i{width:7px;height:7px;border-radius:50%;background:var(--cl-hair)}',
	'.cw-dots i.on{background:var(--c)}',
	'.cw-flash{animation:cw-blink 1s ease-in-out infinite}',
	'@keyframes cw-blink{0%,100%{opacity:1}50%{opacity:.18}}',
	'@media (prefers-reduced-motion:reduce){.cw-flash{animation:none}}',

	/* ---- page header ---- */
	'.cw-led-map>h2{margin:0 0 6px;padding:0 2px;border:0;font:600 24px/1.2 var(--ax-font,inherit);letter-spacing:-.015em}',
	'.cw-led-map>.cbi-map-descr{max-width:760px;margin:0 0 16px;padding:0 2px;font-size:14px;line-height:1.55;color:var(--cl-muted)}',

	/* ---- cards ---- */
	'.cw-led-map .cbi-section{margin:0 0 16px;padding:20px 20px 22px;background:var(--cl-card);border:1px solid var(--cl-hair);border-radius:var(--cl-r);overflow:visible}',
	'.cw-led-map .cbi-section>h3:first-child{margin:0 0 6px;padding:0;font:600 18px/1.3 var(--ax-font,inherit);letter-spacing:-.01em;color:var(--cl-fg)}',
	'.cw-led-map .cbi-section>.cbi-section-descr{max-width:780px;margin:0 0 4px;font-size:14px;line-height:1.5;color:var(--cl-muted)}',
	'.cw-led-map .cbi-section>h3:first-child:not(:has(+.cbi-section-descr)){margin-bottom:16px}',
	'.cw-led-map .cbi-section-node{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px;margin-top:12px;padding-top:18px;border-top:1px solid var(--cl-hair)}',
	'@media (max-width:700px){.cw-led-map .cbi-section{padding:16px 14px 18px}.cw-led-map .cbi-section-node{grid-template-columns:minmax(0,1fr)}}',

	/* ---- field rows: label above control, help below ---- */
	'.cw-led-map .cbi-section-node>.cbi-value{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:0;margin:0;padding:0;border:0}',
	'.cw-led-map .cbi-value-title{flex:none;padding:0;font:600 14px/1.3 var(--ax-font,inherit);letter-spacing:0;text-transform:none;color:var(--cl-fg)}',
	'.cw-led-map .cbi-value-field{width:100%;min-width:0;padding:0}',
	'.cw-led-map .cbi-value-description{max-width:760px;margin:0;font-size:13px;line-height:1.5;color:var(--cl-muted)}',
	/* wide rows (long help or wide control) span both columns */
	'.cw-led-map #cbi-cw-led-modem-port,.cw-led-map #cbi-cw-led-modem-grace_max_ticks,.cw-led-map #cbi-cw-led-night-_timeline,.cw-led-map #cbi-cw-led-night-exempt,',
	'.cw-led-map #cbi-cw-led-night-enabled,.cw-led-map #cbi-cw-led-signal-_scale,.cw-led-map #cbi-cw-led-internet-mode,.cw-led-map #cbi-cw-led-internet-iface{grid-column:1/-1}',

	/* ---- controls ---- */
	/* the widgets sit in a wrapper div (input/select are grandchildren of the field); .cbi-dropdown's own inputs are deeper and untouched */
	'.cw-led-map .cbi-value-field>div>input[type="text"],.cw-led-map .cbi-value-field>div>input[type="number"],.cw-led-map .cbi-value-field>div>select,',
	'.cw-led-map .cbi-value-field>input[type="text"],.cw-led-map .cbi-value-field>input[type="number"],.cw-led-map .cbi-value-field>select{box-sizing:border-box;width:100%;max-width:420px;height:var(--cl-h);padding:0 12px;border:1px solid var(--cl-field);background-color:var(--cl-trk);font:400 14px var(--cl-mono)}',
	'.cw-led-map #cbi-cw-led-internet-probe_url .cbi-value-field input,.cw-led-map #cbi-cw-led-internet-probe_url_fallback .cbi-value-field input{max-width:none}',
	'@media (max-width:700px){.cw-led-map .cbi-value-field>div>input[type="text"],.cw-led-map .cbi-value-field>div>input[type="number"],.cw-led-map .cbi-value-field>div>select,.cw-led-map .cbi-value-field>input[type="text"],.cw-led-map .cbi-value-field>input[type="number"],.cw-led-map .cbi-value-field>select{max-width:none;font-size:16px}}',
	'.cw-led-map .cbi-value-field .cbi-dropdown{box-sizing:border-box;width:100%;max-width:420px;min-height:var(--cl-h);border:1px solid var(--cl-field);background-color:var(--cl-trk)}',
	'.cw-led-map #cbi-cw-led-modem-port .cbi-dropdown,.cw-led-map #cbi-cw-led-internet-mode .cbi-dropdown,.cw-led-map #cbi-cw-led-internet-iface .cbi-dropdown,.cw-led-map #cbi-cw-led-internet-mode select{max-width:560px}',
	'.cw-led-map .cbi-dropdown>ul>li[selected]{background:var(--cl-tint);color:var(--cl-ink)}',
	'.cw-led-map .cbi-range-slider{display:flex;align-items:center;gap:14px;max-width:420px}',
	'.cw-led-map .cbi-range-slider input[type="range"]{flex:1;min-width:0;height:var(--cl-h)}',
	'.cw-led-map .cbi-range-slider output{min-width:46px;padding:4px 10px;border:1px solid var(--cl-hair);background:var(--cl-sub);border-radius:var(--cl-r);font:600 14px var(--cl-mono);text-align:center;color:var(--cl-ink)}',

	/* ---- toggle switch (native checkbox, restyled) ---- */
	'.cw-led-map .cbi-checkbox{display:flex;align-items:center;gap:12px;min-height:var(--cl-h)}',
	'.cw-led-map .cbi-checkbox>input[type="checkbox"]{appearance:none;-webkit-appearance:none;flex:none;box-sizing:border-box;width:44px;height:24px;margin:0;cursor:pointer;border:1px solid var(--cl-field);border-radius:0;',
	'background:linear-gradient(var(--cl-field),var(--cl-field)) 3px 50%/16px 16px no-repeat,var(--cl-trk);transition:background-position .15s}',
	'.cw-led-map .cbi-checkbox>input[type="checkbox"]:checked{border-color:var(--cl-ink);background:linear-gradient(var(--cl-accink),var(--cl-accink)) 23px 50%/16px 16px no-repeat,var(--cl-acc)}',
	'.cw-led-map .cbi-checkbox>input[type="checkbox"]:disabled{opacity:.5;cursor:not-allowed}',
	'.cw-led-map .cbi-checkbox>label{font:500 14px var(--ax-font,inherit);cursor:pointer;color:var(--cl-fg)}',
	'@media (prefers-reduced-motion:reduce){.cw-led-map .cbi-checkbox>input[type="checkbox"]{transition:none}}',

	/* ---- night window + signal scale ---- */
	'.cw-bar{display:flex;height:16px;border:1px solid var(--cl-field);background:var(--cl-trk)}',
	'.cw-bar>div{height:100%}',
	'.cw-ticks{position:relative;height:1.4em;margin-top:6px;font:400 12px var(--cl-mono);color:var(--cl-muted)}',
	'.cw-ticks span{position:absolute;top:0;white-space:nowrap}',
	'.cw-tickrow{display:flex;justify-content:space-between;margin-top:6px;font:400 12px var(--cl-mono);color:var(--cl-muted)}',
	'.cw-leg{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font:500 12px var(--cl-mono);color:var(--cl-muted)}',
	'.cw-leg span{display:inline-flex;gap:6px;align-items:center}.cw-leg i{display:inline-block;width:10px;height:10px;background:var(--c)}'
].join('');

function injectCSS() {
	try {
		if (document.getElementById('cw-led-style'))
			return;
		var st = E('style', { 'id': 'cw-led-style' });
		st.appendChild(document.createTextNode(CW_CSS));
		document.head.appendChild(st);
	} catch (e) { /* styling is optional */ }
}

/* --- live status card ------------------------------------------------------ */

/* One lamp. colour: 'green' | 'blue' | 'red' | 'white' | null (off). */
function lamp(name, colour, state, active, flash) {
	var kids = [
		E('span', { 'class': 'cw-lamp' + (flash ? ' cw-flash' : '') }),
		E('span', { 'class': 'cw-n' }, name),
		E('span', { 'class': 'cw-s' }, state),
		E('span', { 'class': 'cw-dots' }, (active === null || active === undefined) ? [] : dots(active))
	];
	return E('div', { 'class': 'cw-led' + (colour ? ' cw-c-' + colour : ' off') }, kids);
}

/* Tri-colour channel dots (blue, green, red): 'white' lights all three,
 * '<c>-flash' lights its base colour, else the single matching member. */
function dots(active) {
	var all = (active === 'white');
	var base = (active || '').replace(/-flash$/, '');
	return LED_KEYS.map(function(p) {
		return E('i', { 'class': 'cw-c-' + p + ((all || base === p) ? ' on' : '') });
	});
}

function monoLamp(leds, node, name) {
	var on = !!(leds && leds[node] && leds[node].brightness > 0);
	return lamp(name, on ? 'green' : null, on ? _('on') : _('off'));
}

/* Wi-Fi lamp: in netdev mode the kernel blinks green:wifi on traffic, and a
 * status snapshot every 5 s would catch a random on or off. So go by the trigger
 * and show a steady pulse. 'auto' mode is plain on/off from the daemon. */
function wifiLamp(leds) {
	var l = leds && leds['green:wifi'];
	if (l && l.trigger === 'netdev')
		return lamp(_('Wi-Fi'), 'green', _('traffic'), null, true);
	var on = !!(l && l.brightness > 0);
	return lamp(_('Wi-Fi'), on ? 'green' : null, on ? _('on') : _('off'));
}

function triLamp(color, name, words) {
	color = color || 'off';
	var flash = /-flash$/.test(color);
	var base = color.replace(/-flash$/, '');       // green-flash -> green; white stays white
	var key = (base === 'off') ? null : base;
	var label = words[color] || words[base] || _('off');
	return lamp(name, key, label, color, flash);
}

function renderStatus(st) {
	var box = E('section', { 'id': 'cw-led-status', 'class': 'cw-live', 'aria-label': _('Live LED status') });
	try {
		var leds = (st && st.leds) || {};
		var dRun = !!(st && st.daemon_running);
		var nAct = !!(st && st.night_active);

		box.appendChild(E('div', { 'class': 'cw-chips' }, [
			E('span', { 'class': 'cw-chip ' + (dRun ? 'cw-c-green' : 'cw-c-red') }, [
				E('i'), _('Daemon') + ' · ' + (dRun ? _('running') : _('stopped'))
			]),
			E('span', { 'class': 'cw-chip ' + (nAct ? 'cw-c-blue' : 'idle') }, [
				E('i'), _('Night mode') + ' · ' + (nAct ? _('active') : _('idle'))
			])
		]));

		/* Read-only: green:phone is driven by something else, this app never writes it. */
		var phoneOn = !!(leds['green:phone'] && leds['green:phone'].brightness > 0);
		box.appendChild(E('div', { 'class': 'cw-leds' }, [
			monoLamp(leds, 'green:power', _('Power')),
			wifiLamp(leds),
			triLamp((st && st.color_5g) || 'off', _('5G'),
				{ blue: _('5G SA'), green: _('5G NSA'), off: _('no 5G') }),
			triLamp((st && st.color_signal) || 'off', _('Signal'),
				{ green: _('good'), blue: _('average'), red: _('poor'),
				  'red-flash': _('connecting'), off: _('unavailable') }),
			monoLamp(leds, 'green:internet', _('Internet')),
			lamp(_('Phone'), phoneOn ? 'green' : null, _('external'))
		]));
	} catch (e) {
		box.appendChild(E('div', { 'style': 'opacity:.6' }, _('Status unavailable')));
	}
	return box;
}

/* --- read-only visual editors (drawn from the saved config) --------------- */

/* One strict HH:MM (24h) pattern for both the validator and the parser, the same
 * as the daemon expects (two-digit hour, no H:MM shorthand). */
var TIME_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

function toMin(t) {
	var m = TIME_RE.exec(String(t == null ? '' : t).trim());
	return m ? (+m[1] * 60 + (+m[2])) : null;
}

function buildTimeline(start, end) {
	try {
		var s = toMin(start), e = toMin(end), segs = [];
		function seg(a, b, night) {
			if (b <= a) return;
			segs.push(E('div', { 'class': night ? 'cw-c-blue' : '',
				'style': 'width:' + ((b - a) / 1440 * 100) + '%' + (night ? ';background:var(--c)' : '') }));
		}
		if (s === null || e === null || s === e) seg(0, 1440, false);
		else if (s < e) { seg(0, s, false); seg(s, e, true); seg(e, 1440, false); }
		else { seg(0, e, true); seg(e, s, false); seg(s, 1440, true); }
		return E('div', {}, [
			E('div', { 'class': 'cw-bar', 'role': 'img',
				'aria-label': _('Night window') + ': ' + (start || '?') + ' – ' + (end || '?') }, segs),
			E('div', { 'class': 'cw-tickrow' }, [
				E('span', {}, '00:00'), E('span', {}, '06:00'), E('span', {}, '12:00'),
				E('span', {}, '18:00'), E('span', {}, '24:00')
			])
		]);
	} catch (e2) {
		return E('div', { 'style': 'opacity:.6' }, _('Night window') + ': ' + (start || '?') + ' – ' + (end || '?'));
	}
}

function dbmPct(v) {
	var p = (v + 44) / (-96) * 100;
	return Math.max(0, Math.min(100, p));
}

/* RSRP scale with the configured limits: excellent (blue) down to the
 * excellent threshold, "between" (amber) down to the poor threshold, then poor
 * (red). */
function buildScale(exc, poor) {
	try {
		var e = parseInt(exc, 10), p = parseInt(poor, 10);
		if (isNaN(e)) e = -95;
		if (isNaN(p)) p = -110;
		var pe = dbmPct(e), pp = dbmPct(p);
		return E('div', { 'class': 'cw-scale' }, [
			E('div', { 'class': 'cw-bar', 'role': 'img',
				'aria-label': _('Signal scale') + ': ' + _('excellent') + ' −44 … ' + e + ', ' + _('between') + ' … ' + p + ', ' + _('poor') + ' … −140' }, [
				E('div', { 'class': 'cw-c-blue', 'style': 'width:' + Math.max(0, pe) + '%;background:var(--c)' }),
				E('div', { 'class': 'cw-c-amber', 'style': 'width:' + Math.max(0, pp - pe) + '%;background:var(--c)' }),
				E('div', { 'class': 'cw-c-red', 'style': 'width:' + Math.max(0, 100 - pp) + '%;background:var(--c)' })
			]),
			E('div', { 'class': 'cw-ticks', 'aria-hidden': 'true' }, [
				E('span', { 'style': 'left:0' }, '−44'),
				E('span', { 'style': 'left:' + pe + '%' }, String(e)),
				E('span', { 'style': 'left:' + pp + '%' }, String(p)),
				E('span', { 'style': 'right:0' }, '−140')
			]),
			E('div', { 'class': 'cw-leg' }, [
				E('span', { 'class': 'cw-c-blue' }, [ E('i'), _('excellent') ]),
				E('span', { 'class': 'cw-c-amber' }, [ E('i'), _('between') ]),
				E('span', { 'class': 'cw-c-red' }, [ E('i'), _('poor') ])
			])
		]);
	} catch (e3) {
		return E('div', { 'style': 'opacity:.6' }, '−44 … −140 dBm');
	}
}

/* Checkbox shown as a toggle switch. The native <input type="checkbox"> stays
 * (keyboard, forms, validation) and is restyled in CSS; the empty <label> gets
 * the state text. */
var SwitchFlag = form.Flag.extend({
	renderWidget: function(/* ... */) {
		var el = this.super('renderWidget', arguments);

		try {
			var cb = el.querySelector('input[type="checkbox"]'),
			    lb = el.querySelector('label');

			if (cb && lb) {
				var sync = function() { lb.textContent = cb.checked ? _('Enabled') : _('Disabled'); };

				cb.setAttribute('role', 'switch');
				cb.addEventListener('change', sync);
				sync();
			}
		}
		catch (e) { /* the plain checkbox still works */ }

		return el;
	}
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('cw-led'),
			callStatus().catch(function() { return null; }),
			callOptions().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var m, s, o;
		var opts = data[2] || {};

		injectCSS();

		var statusBox = renderStatus(data[1]);

		poll.add(function() {
			return callStatus().then(function(st) {
				var fresh = renderStatus(st);
				var cur = document.getElementById('cw-led-status');
				if (cur && cur.parentNode)
					cur.parentNode.replaceChild(fresh, cur);
			}).catch(function() {});
		}, 5);

		m = new form.Map('cw-led', _('LED Management'),
			_('Drive the AW1000 physical LEDs from live modem and network status, with an optional night window. Self-contained - modem data is read directly over the AT port.'));

		/* --- general ----------------------------------------------------- */
		s = m.section(form.NamedSection, 'global', 'cw-led', _('General'));

		o = s.option(isApexTheme() ? SwitchFlag : form.Flag, 'enabled', _('Enable LED daemon'));
		o.rmempty = false;
		o.default = '1';

		o = s.option(form.RangeSliderValue, 'poll_interval', _('Modem poll interval (s)'),
			_('How often the AT port is queried for 5G/signal status.'));
		o.min = 10;
		o.max = 300;
		o.step = 5;
		o.default = '30';

		/* --- modem -------------------------------------------------------- */
		s = m.section(form.NamedSection, 'modem', 'modem', _('Modem AT port'));

		o = s.option(form.Value, 'port', _('AT port device'),
			_('Quectel AT command port. If unresponsive, other ttyUSB ports are probed automatically at runtime.'));
		o.placeholder = '/dev/ttyUSB3';
		addChoices(o, opts.serial_ports);

		o = s.option(form.Value, 'timeout', _('AT response timeout (s)'));
		o.datatype = 'range(1,10)';
		o.placeholder = '3';

		o = s.option(form.Value, 'fail_threshold', _('Failure threshold'),
			_('Consecutive failed AT polls before the 5G and signal LEDs are switched off (status unknown).'));
		o.datatype = 'range(1,10)';
		o.placeholder = '3';

		o = s.option(form.Value, 'grace_max_ticks', _('Contention grace (polls)'),
			_('When a truncated modem reply leaves the network type briefly unreadable but the modem is still connected, hold the last 5G and signal colour for up to this many polls instead of blanking. 0 disables (blank immediately).'));
		o.datatype = 'range(0,10)';
		o.placeholder = '2';

		/* --- night mode ---------------------------------------------------- */
		s = m.section(form.NamedSection, 'night', 'night', _('Night mode'),
			_('Inside the window, LEDs not in the exempt list are switched off. The hardware cannot dim - LEDs are binary on/off.'));

		o = s.option(isApexTheme() ? SwitchFlag : form.Flag, 'enabled', _('Enable night mode'));
		o.rmempty = false;

		function validateTime(section_id, value) {
			if (value == null || value == '')
				return true;
			if (TIME_RE.test(value))
				return true;
			return _('Expecting a time in HH:MM (24h) format');
		}

		o = s.option(form.Value, 'start', _('Window start (HH:MM)'));
		o.placeholder = '22:30';
		o.depends('enabled', '1');
		o.validate = validateTime;

		o = s.option(form.Value, 'end', _('Window end (HH:MM)'),
			_('A window past midnight (e.g. 22:30 to 06:00) is supported.'));
		o.placeholder = '06:00';
		o.depends('enabled', '1');
		o.validate = validateTime;

		o = s.option(form.DummyValue, '_timeline', _('Night window'));
		o.depends('enabled', '1');
		o.cfgvalue = function() {
			// Read the saved config (uci.get) only, never formvalue() or the DOM:
			// cfgvalue runs before the widgets exist, and formvalue() would throw
			// (findElement -> querySelectorAll on undefined).
			return buildTimeline(uci.get('cw-led', 'night', 'start') || '22:30',
				uci.get('cw-led', 'night', 'end') || '06:00');
		};

		o = s.option(form.MultiValue, 'exempt', _('Keep on during night'),
			_('Selected LEDs stay on inside the night window. The Phone LED is not controlled by this app, so night mode does not affect it.'));
		o.depends('enabled', '1');
		o.value('power', _('Power'));
		o.value('wifi', _('Wi-Fi'));
		o.value('fiveg', _('5G'));
		o.value('signal', _('Signal'));
		o.value('internet', _('Internet'));

		/* --- individual LEDs ---------------------------------------------- */
		/* Every LED is always managed: power is default-on, 5G and signal are
		 * tri-color. The phone LED is not ours. Only LEDs with real settings get
		 * a section. */
		s = m.section(form.NamedSection, 'wifi', 'led', _('Wi-Fi LED'),
			_('This hardware ignores the kernel radio LED triggers, so "Auto" is daemon-driven.'));
		o = s.option(form.ListValue, 'mode', _('Mode'));
		o.value('auto', _('Auto - lit when any radio is up'));
		o.value('netdev', _('Single interface - blinks on traffic'));
		o.default = 'auto';
		o = s.option(form.Value, 'device', _('Wi-Fi interface'),
			_('Interface whose traffic blinks the LED. Pick one Wi-Fi interface, or a bridge such as br-lan to follow both radios (a bridge also carries ethernet LAN). Leave blank for the first Wi-Fi interface found.'));
		o.datatype = 'netdevname';
		o.placeholder = _('first interface found');
		o.depends('mode', 'netdev');
		addChoices(o, opts.wifi_ifaces);
		addChoices(o, opts.bridges);

		s = m.section(form.NamedSection, 'signal', 'led', _('Signal LED'),
			_('Green: good. Blue: average. Red: poor or no service. Based on RSRP, with CSQ as fallback.'));

		o = s.option(form.DummyValue, '_scale', _('Signal scale (dBm)'));
		o.cfgvalue = function() {
			// Saved config only, no formvalue() or DOM read here (see the night window above).
			return buildScale(uci.get('cw-led', 'signal', 'rsrp_excellent') || '-95',
				uci.get('cw-led', 'signal', 'rsrp_poor') || '-110');
		};

		o = s.option(form.Value, 'rsrp_excellent', _('RSRP excellent threshold (dBm)'),
			_('RSRP at or above this shows blue.'));
		o.datatype = 'range(-140,-44)';
		o.placeholder = '-95';

		o = s.option(form.Value, 'rsrp_poor', _('RSRP poor threshold (dBm)'),
			_('RSRP at or below this shows red. Must be lower than the excellent threshold.'));
		o.datatype = 'range(-140,-44)';
		o.placeholder = '-110';
		o.validate = function(section_id, value) {
			if (value == null || value == '')
				return true;
			var exc = this.map.lookupOption('rsrp_excellent', section_id);
			var excVal = exc ? exc[0].formvalue(section_id) : null;
			if (excVal && parseInt(value, 10) >= parseInt(excVal, 10))
				return _('Poor threshold must be lower than the excellent threshold');
			return true;
		};

		o = s.option(form.Value, 'csq_excellent', _('CSQ excellent threshold'),
			_('Used when RSRP is unavailable.'));
		o.datatype = 'range(0,31)';
		o.placeholder = '20';

		o = s.option(form.Value, 'csq_poor', _('CSQ poor threshold'));
		o.datatype = 'range(0,31)';
		o.placeholder = '9';
		o.validate = function(section_id, value) {
			if (value == null || value == '')
				return true;
			var exc = this.map.lookupOption('csq_excellent', section_id);
			var excVal = exc ? exc[0].formvalue(section_id) : null;
			if (excVal && parseInt(value, 10) >= parseInt(excVal, 10))
				return _('Poor threshold must be lower than the excellent threshold');
			return true;
		};

		s = m.section(form.NamedSection, 'internet', 'led', _('Internet LED'),
			_('On this device the internet LED reflects the modem data connection (wwan0), not the ethernet WAN.'));

		o = s.option(form.ListValue, 'mode', _('Check mode'),
			_('HTTP 204 actively confirms real reachability (catches "link up but no internet"). Interface = link-up only. Ping = ICMP a host.'));
		o.value('http204', _('Active connectivity probe (HTTP 204)'));
		o.value('interface', _('Default-route interface is up'));
		o.value('ping', _('Ping a host'));
		o.default = 'http204';

		o = s.option(form.Value, 'iface', _('Interface'),
			_('Logical interface to watch, or "auto" to follow the default route.'));
		o.placeholder = 'auto';
		o.depends('mode', 'interface');
		o.depends('mode', 'http204');
		o.value('auto', _('Automatic (default route)'));
		addChoices(o, opts.net_interfaces);

		o = s.option(form.Value, 'ping_host', _('Ping host'));
		o.datatype = 'host';
		o.placeholder = '1.1.1.1';
		o.depends('mode', 'ping');

		o = s.option(form.Value, 'probe_url', _('Probe URL'),
			_('Endpoint that returns HTTP 204. Use plain http:// so captive portals are detected.'));
		o.placeholder = 'http://cp.cloudflare.com/generate_204';
		o.depends('mode', 'http204');

		o = s.option(form.Value, 'probe_url_fallback', _('Fallback probe URL'));
		o.placeholder = 'http://connectivitycheck.gstatic.com/generate_204';
		o.depends('mode', 'http204');

		o = s.option(form.Value, 'probe_every', _('Probe interval (ticks)'),
			_('Ticks between probes (one tick is the global tick, 5 s by default). Other LEDs still update every tick.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '6';
		o.depends('mode', 'http204');

		return m.render().then(function(mapEl) {
			if (isApexTheme())
				mapEl.classList.add('cw-led-map');

			return E('div', { 'class': 'cw-led-page' }, [ statusBox, mapEl ]);
		});
	}
});
