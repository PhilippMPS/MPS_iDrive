# MPS Live App 1.3.0 (ID: mps_engine_config)

1.3.0: Freischaltung per VIN-Code (Settings → Activation).

1.2.1: „Forgot PIN“ – Rücksetzcode aus der VIN (reset_code.js).

1.2.0: Name „MPS Live App“, neues Icon, Beschreibung ohne Sperr-Funktion.

1.1.1: Im gesperrten Zustand ist das Schloss im Header (und „Lock screens“ in der HMI-Leiste) ausgeblendet.

Engine Config 0.9.3 (Exhaust Flap, Tune, xDrive) mit MPS-Erweiterungen.

## Seiten

- Immer sichtbar: **Live**, **Instruments**, **xDrive live**, **Settings**. Die App öffnet immer auf Live.
- Sperrbar: **Exhaust Flap**, **Engine Map**, **Max Cooling**, **Burbles**, **Active Sound**, **xDrive**
  (die Seiten, die Befehle ans Auto schicken).
- Live-Seiten konfigurierbar in `live_pages.js` (Liste `PAGES`: Tab-Name, Layout, Werte).

## Freischaltung

- Ohne Freischaltung nur **Live**, **Instruments**, **xDrive live**, **Settings**. Funktionsseiten, ihre
  Einstellungen, das Schloss und Security sind unsichtbar; Klappe (disarmed), Tuning-Software und xDrive
  werden auf „aus“ gezwungen – es geht nichts ans Auto.
- Settings → Activation → Features → „Enter activation code“ → App zeigt die VIN → MPS erzeugt den Code mit
  `mps_codes.py activate <VIN>` (NICHT im Repo) → Kunde gibt 10 Ziffern ein → alles frei.
- Gespeichert in `data/activation.json` (VIN + Code), bei jedem Start erneut geprüft. Gleiche VIN = gleicher
  Code, also auch nach Neuinstallation wieder verwendbar. Eigener Schlüssel (`ACT_KEY` in `reset_code.js`).
- Falsche Codes zählen wie falsche PINs (Wartezeiten).

## Sperre

- **Schloss im Header** (hinter SIM, im gesperrten Zustand ausgeblendet): sperrt sofort, ohne PIN-Eingabe. Ohne PIN wird zuerst eine
  eingerichtet. Gesperrt = sperrbare Seiten und ihre Einstellungen ausgeblendet, Befehle abgewiesen.
  Klappen-Automatik (Drive mode, Hold, rpm-Grenze) läuft weiter wie eingestellt.
- **Entsperren:** Settings → Security → „Enable locked screens“ → PIN.
- **Settings → Security:** Enable locked screens · PIN (setzen / ändern / entfernen) ·
  Lock screens again (nur per Schloss, beim Schließen, nach 1/5/15 min, bei Zündung aus).
- Gesperrt bleibt gesperrt, auch nach Neustart.
- Gespeichert in `data/pin_lock.json`: gesalzener SHA-256-Hash, nie die PIN.
  Ab dem 5. Fehlversuch Wartezeit (30 s, steigend bis 15 min).
- **PIN vergessen:** Im PIN-Feld „Forgot PIN“ → die App zeigt die VIN (aus der DME, UDS 22 F190) → MPS erzeugt
  den 10-stelligen Code mit `mps_codes.py reset <VIN>` (liegt NICHT im Repo) → Kunde gibt ihn ein → PIN gelöscht,
  alle Seiten sichtbar. Falsche Codes zählen wie falsche PINs (Wartezeiten). Gleiche VIN = gleicher Code.
  Schlüssel in `reset_code.js` geheim halten (Repo privat); neuer Schlüssel macht alle alten Codes ungültig.
  Notfall ohne Code: `pin_lock.json` per SSH löschen.
- Ohne Touch-Renderer: „Lock screens“ in der HMI-Leiste, PIN über „Digit +/−“ / „Enter digit“.

## Kit-Erweiterung (nötig!)

Der Schloss-Button im Header braucht eine Erweiterung im Kit (`ctx.onHeaderAction`, Aktions-Button nach
den Badges). Geänderte Dateien: `kit/runtime/gauges.js`, `kit/runtime/display.js`, `kit/runtime/mgu.js`,
`kit/tools/hu-stub.js` (Emulator). Nur aktiv, wenn eine App den Button anmeldet – andere Apps unverändert.
Als Diff: `kit-header-action.patch` (Basis: idrive7-apps GitHub main, Stand Nov. 2026).

## Bauen / Installieren

1. Emulator: `node kit/tools/emu.js mps_engine_config` → http://localhost:8077
2. Paket (echtes `oap-sdk` nötig): `python3 kit/tools/build.py mps_engine_config`
3. HU: `sh mgu-app-install.sh install mps_engine_config@1.3.0.mgu`

## Teststand

- Emulator (Touch): Sperren per Schloss inkl. PIN-Einrichtung, gesperrte Tabs/Settings,
  Entsperren über Settings → Security, Speicherung `hidden`.
- Sperrlogik automatisiert: Neustart gesperrt/offen, PIN ändern/entfernen, Fehlversuche.
- Kit-Tests (runtime, exhaust, widgets, hud) weiterhin grün.
- NICHT getestet: Bedienung ohne Touch-Renderer, echtes Auto.
