# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 Pr0Luci

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-cw-led
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Pr0Luci <Pr0Luci@users.noreply.github.com>

LUCI_TITLE:=LED management for the Arcadyan AW1000
LUCI_DESCRIPTION:=Physical LED status daemon and night-mode scheduler for the AW1000 \
	(power, Wi-Fi, tri-color 5G and signal, internet). Modem data is read \
	directly over the AT port, so no other app is needed.
# netifd provides the network.* ubus objects the internet LED looks up,
# jsonfilter is used by the rpcd plugin, curl runs the HTTP 204 probe.
LUCI_DEPENDS:=+luci-base +netifd +jsonfilter +curl
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/cw-led
endef

# Restart the daemon on upgrade so it picks up the new code. Skipped during
# image builds (IPKG_INSTROOT is set there).
define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/rpcd reload 2>/dev/null
/etc/init.d/cw-led enabled && /etc/init.d/cw-led restart 2>/dev/null
exit 0
endef

# Stop and disable the daemon on removal. Its TERM trap restores the power and
# Wi-Fi triggers and turns the daemon-owned LEDs off. Their stock `config led`
# sections were removed by uci-defaults/90-cw-led, so those LEDs stay off until
# a factory reset.
define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/cw-led stop 2>/dev/null
/etc/init.d/cw-led disable 2>/dev/null
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
