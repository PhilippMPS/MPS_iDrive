# MPS iDrive

Apps für die BMW-Headunit MGU (iDrive 7) von MPS Engineering, installierbar über den
[MGU Store](https://github.com/robertnisipeanu/mgu-store) (Quelle: dieses Repository, Branch `main`).

## Apps

| App | Beschreibung |
|---|---|
| **MPS Live App** (`apps/mps_engine_config`) | Live-Daten, Instrumente, xDrive live, Abgasklappe, Engine Map, Max Cooling, xDrive. Technische Details: `apps/mps_engine_config/README_MPS.md` |

## Im Store installieren

Settings → Add source → `PhilippMPS/MPS_iDrive` → Branch `main`.
Privates Repository: vorher unter Settings → Accounts mit GitHub anmelden oder einen Token hinterlegen.

Die Headunit baut die Apps selbst aus dem Quellcode (`mgu-repo.json`) mit ihrem eigenen BMW-SDK.
**Niemals** `oap-sdk/`, `dist/` oder gebaute `.mgu`/`.tgz`-Pakete einchecken – sie enthalten BMWs SDK.

## Entwickeln

```
node kit/tools/emu.js mps_engine_config     # Emulator → http://localhost:8077
```

Neue Version: `version` in `apps/<app>/app.json` erhöhen, committen, pushen – der Store bietet das Update an.

## Herkunft und Lizenz

Kit, Renderer und Engine Config basieren auf [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)
(MIT, siehe `LICENSE`; der Renderer in `kit/renderd` steht unter GPL-3.0, siehe dort).
MPS-Erweiterungen: Live-Seiten, PIN-Sperre, Header-Aktionsbutton im Kit (`ctx.onHeaderAction`).
Inoffizielles Projekt, nicht von BMW AG. Nutzung auf eigenes Risiko.
