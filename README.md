# luci-app-cw-led

Part of [CleanWRT](https://github.com/Pr0Luci/cleanwrt-aw1000). Documentation: [Front-panel LEDs](https://pr0luci.github.io/cleanwrt-aw1000/docs/leds/).

LED management for the Arcadyan AW1000 5G router on OpenWrt 25.12. A small shell daemon drives the
front-panel LEDs from live modem and network state, and a LuCI page (System > LED Management) shows
the current state and edits the settings.

## What it does

| LED | Shows |
|---|---|
| Power | always on |
| Wi-Fi | lit while any radio is up, or blinks with traffic on one interface (netdev mode) |
| 5G | SA solid blue, NSA solid green, anything else off |
| Signal | green good, blue average, red poor (by RSRP, CSQ as fallback); red flash while connecting or on a SIM fault; off when unavailable |
| Internet | on while an HTTP 204 probe (or link state, or ping) says the uplink works |

An optional night window switches chosen LEDs off between two times, including windows that cross
midnight. The hardware has no dimming, every LED is on or off.

Modem data is read straight from the modem's AT port with plain BusyBox shell, so no other app is
needed. The default is `/dev/ttyUSB2`; if it doesn't answer, the daemon tries the other ttyUSB ports.

## Build

Put this repository in a feed, or copy `luci-app-cw-led/` into `package/` of an OpenWrt 25.12 tree, then:

```
make menuconfig            # LuCI > Applications > luci-app-cw-led
make package/luci-app-cw-led/compile
```

Install the resulting `.apk` on the router with `apk add --allow-untrusted`.

Runtime dependencies: `luci-base`, `netifd`, `jsonfilter`, `curl`.

## Configuration

`/etc/config/cw-led`, or the LuCI page. The defaults are in the file. Service control:

```
/etc/init.d/cw-led restart
logread -e cw-led
```

## Theme

The card layout and the toggle switches are styled for the Apex theme. Other themes get the stock form,
and the live status card works in any theme.

## Licence

GPL-2.0-only, see `LICENSE`.
