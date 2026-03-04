# StratoNova – CesiumJS Free-Tier Build

Statischer Browser-Client mit CesiumJS + Google Photorealistic 3D Tiles + CZML-Replay + OSINT-Layern.

## Kosten & Limits (verbindlich)

- Google Photorealistic 3D Tiles: Free-Tier schonend nutzen, Root-Requests minimieren.
- Cesium ion: Community Free Tier.
- OpenSky: Polling mit niedriger Frequenz (10s) und Fallback.
- Celestrak TLE: kostenlos.
- Hosting: Vercel (primär), GitHub Pages (Fallback), Azure Static Web Apps (optional).

## Lokaler Start

```bash
cd Worldview
npm ci
npm run dev
```

Build:

```bash
cd Worldview
npm run build
npm run preview
```

## Environment

Beispielwerte in [`Worldview/.env.example`](Worldview/.env.example).

Wichtige Variablen:
- `VITE_CESIUM_ION_TOKEN`
- `VITE_GOOGLE_MAP_TILES_KEY`
- `VITE_ADSB_FALLBACK_URL`
- `VITE_AISSTREAM_API_KEY` (primär; API-Key für AISStream Live-Feed)
- `VITE_AIS_WS_API_KEY` (Legacy-Fallback; wird genutzt, wenn `VITE_AISSTREAM_API_KEY` nicht gesetzt ist)
- `VITE_AIS_WS_URL` (optional; Provider-spezifische WebSocket-URL für Legacy/Fallback)

## AIS Quellen & Lizenz/Nutzung

### Primärquelle: AISStream

- Standardquelle für Live-AIS im Viewer.
- Authentifizierung per `VITE_AISSTREAM_API_KEY`.
- Nutzung nur gemäß aktueller AISStream ToS/Lizenz (insbesondere Weitergabe/Redistribution und zulässige Use-Cases prüfen).
- Default-Betriebsmodus ist **Bounding-Box-only** (regionale Subscription statt globalem Firehose-Feed).

### Optionaler Fallback: AISHub

- Nur als Ausweichpfad bei Ausfall/Rate-Limit/Auth-Problemen der Primärquelle.
- Nutzung nur gemäß AISHub ToS; erforderliche Attribution im Produkt/Projekt dokumentieren.
- Kein permanenter Parallelbetrieb mit Primärquelle, außer für gezielte Diagnosefenster.

### Historisches Replay: NOAA/CSV

- Historische AIS-Replays basieren auf extern beschafften CSV-Dateien (z. B. NOAA-Datensätze).
- Rohdaten werden **nicht** im Repository versioniert oder mitgeliefert.
- Verarbeitung erfolgt lokal/auf Worker über [`tools/czml_generator.py`](Worldview/tools/czml_generator.py).

### Betriebsgrenzen (verbindlich)

- Keine globale Standard-Subscription als Default-Konfiguration.
- Rate-limit-schonender Betrieb: regionale Filter, kontrollierte Reconnect-Strategie, Backoff bei Fehlern.
- Bei ToS-/Quota-Verletzungsrisiko muss der Feed auf Fallback oder Replay-only reduziert werden.

## AIS Validierung

Die folgenden Prüfungen sind als operatives Validierungskonzept für die AIS-Kette definiert (Live und Replay).

### 1) Live-Health

Prüfziele:
- `connected` ist `true`, solange ein valider Live-Stream aktiv ist.
- `last-message-age` bleibt im erwarteten Fenster (z. B. <= 60s unter Normalbetrieb).
- `fallback-state` ist eindeutig (`none`/`aishub`/`replay-only`) und im UI/Log nachvollziehbar.

Prüfschritte:
1. App starten: `npm run dev`.
2. AIS-Layer aktivieren und mindestens 2 Minuten beobachten.
3. Verifizieren, dass eingehende AIS-Nachrichten den `last-message-age` regelmäßig zurücksetzen.

### 2) Fallback-Umschaltung (Timeout/Auth/Error)

Prüfziele:
- Timeout, Auth-Fehler oder Verbindungsfehler lösen deterministisch den Fallback-Pfad aus.
- Rückkehr zur Primärquelle erfolgt kontrolliert (kein Reconnect-Sturm).

Prüfschritte:
1. Auth-Fehler simulieren (ungültiger `VITE_AISSTREAM_API_KEY`) und App neu starten.
2. Timeout simulieren (Netzwerk trennen/WS blockieren).
3. Erwartung: Status wechselt auf Fallback (`aishub`) oder auf `replay-only`, inkl. klarer Fehlermeldung.

### 3) Replay-Konsistenz (CSV -> CZML -> Viewer)

Prüfziele:
- Aus CSV erzeugte CZML-Dateien sind syntaktisch und zeitlich konsistent.
- Viewer-Timeline zeigt erwartete Bewegungsdaten ohne Zeitversatz/Entity-Sprünge.

Prüfschritte:
1. One-shot-Generierung ausführen:

   ```bash
   cd Worldview
   python3 tools/czml_generator.py --once --out .
   ```

2. Replay validieren:

   ```bash
   cd Worldview
   python3 ./ops/validate-replay.py --root . --fail-on-empty
   ```

3. Viewer öffnen und generierte Replay-Datei im Zeitbereich prüfen (Start/Ende, Entity-Anzahl, Pfadkontinuität).

### 4) Minimaler lokaler Testablauf

```bash
cd Worldview
npm ci
npm run dev
npm run build
python3 tools/czml_generator.py --once --out .
python3 ./ops/validate-replay.py --root . --fail-on-empty
```

Akzeptanzkriterien:
- Dev-Start und Build ohne Fehler.
- Generatorlauf erzeugt Replay-Artefakte.
- Replay-Validator meldet keinen Fehler.
- AIS-Live-Health/Fallback-State sind im Laufzeitbetrieb nachvollziehbar.

## Live-Demo

- Primär: Vercel Production URL (Projekt-Deployment)
- Fallback: GitHub Pages (Workflow-gesteuert)

Hinweis zur Sichtbarkeit der fotorealistischen 3D Tiles:
- Wenn [`VITE_GOOGLE_MAP_TILES_KEY`](Worldview/.env.example) fehlt/ungültig ist, schaltet die App automatisch auf OSM-Globus-Fallback.
- Das HUD zeigt dann einen klaren Laufzeit-Hinweis (Tiles Fallback Banner + Runtime Diagnostics).

## Production Hosting (Vercel primary, GitHub Pages fallback, Azure optional)

### Empfohlene Topologie

- **Primär (Production): Vercel**
  - Bestehende Live-URL bleibt der Standard-Endpunkt.
  - Statisches Vite-Build (`dist`) wird direkt ausgeliefert.
  - SPA-Rewrite ist über [`Worldview/vercel.json`](Worldview/vercel.json) explizit abgesichert.
- **Fallback (Disaster Recovery): GitHub Pages**
  - Automatischer Build/Deploy über [`Worldview/.github/workflows/github-pages.yml`](Worldview/.github/workflows/github-pages.yml).
  - SPA-Fallback via `404.html` wird im Workflow aus `dist/index.html` erzeugt.
- **Optional (nicht primär): Azure Static Web Apps**
  - Bereits vorhanden über [`Worldview/.github/workflows/azure-static-web-apps.yml`](Worldview/.github/workflows/azure-static-web-apps.yml).
  - Nur optionaler zusätzlicher Provider, keine harte Produktiv-Abhängigkeit.

### Runbook: Provider-Failover (ohne Code-Änderung)

1. **Vercel gesund?**
   - Wenn ja: keine Aktion.
2. **Vercel-Ausfall bestätigt**
   - In GitHub Actions den Workflow [`Deploy to GitHub Pages`](Worldview/.github/workflows/github-pages.yml) per `workflow_dispatch` ausführen.
3. **Pages-Deploy validieren**
   - Prüfen, dass die Pages-URL lädt (Startseite + tiefer SPA-Pfad).
4. **Traffic-Umschaltung**
   - DNS/Link-Ziel auf GitHub Pages setzen (oder Statuspage/Kommunikationskanal auf Pages-URL aktualisieren).
5. **Rückschwenk auf Vercel**
   - Nach Recovery wieder Vercel als primären Endpunkt setzen.

### Optionaler Azure-Pfad (nur wenn bewusst gewünscht)

- Workflow: [`Worldview/.github/workflows/azure-static-web-apps.yml`](Worldview/.github/workflows/azure-static-web-apps.yml)
- Zusätzliche SWA-Routing/Security-Konfiguration: [`Worldview/staticwebapp.config.json`](Worldview/staticwebapp.config.json)
- Erforderliches Secret: `AZURE_STATIC_WEB_APPS_API_TOKEN`

## Production Readiness

Diese Punkte sind als Release-Gate für `main` definiert und müssen grün sein, bevor ein produktiver Deploy akzeptiert wird.

### Checkliste

- [ ] CI Gate bestanden: [`npm ci`](Worldview/package.json), [`npm run typecheck`](Worldview/package.json), [`npm run build`](Worldview/package.json)
- [ ] Deploy wird nur nach erfolgreichem Verify-Job ausgeführt (Workflow-`needs`)
- [ ] CSP/Headers aktiv über [`Worldview/staticwebapp.config.json`](Worldview/staticwebapp.config.json)
- [ ] SPA-Fallback bricht keine Cesium-Assets und keine Replay-Daten (`/cesium/*`, `/assets/*`, `/data/*`, `*.czml`, `*.json` sind ausgenommen)
- [ ] CZML-MIME-Type gesetzt (`.czml` → `application/json`)
- [ ] Erforderliches Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` im Repository vorhanden

### Release-Gate (verbindlich)

1. Pull Request nach `main` nur mergen, wenn der Verify-Job vollständig erfolgreich ist.
2. Direkter Push auf `main` deployt nur nach erfolgreicher Verify-Phase.
3. Bei CSP-/Routing-Änderungen muss ein Preview-Lauf prüfen, dass Google Tiles, Cesium Worker und CZML-Replay weiterhin laden.

## Ubuntu AI-Swarm / CZML-Generator

Datei: [`Worldview/tools/czml_generator.py`](Worldview/tools/czml_generator.py)

Einmaliger Cron-Lauf:

```bash
python3 Worldview/tools/czml_generator.py --once --out /pfad/zum/repo
```

Optional mit Datum:

```bash
python3 Worldview/tools/czml_generator.py --once --date 2026-03-01 --out /pfad/zum/repo
```

Output-Struktur:
- `data/replay/YYYY-MM-DD/satellites-part-01.czml`
- `data/replay/YYYY-MM-DD/adsb-part-01.czml`

## VPS Runbook (91.99.184.153)

Dieses Runbook ist für die serverseitige Ausführung nach wiederhergestelltem SSH-Zugang vorgesehen.
Keine Schritte auslassen, da SSH/Firewall-Härtung bewusst in sicherer Reihenfolge erfolgt.

### Voraussetzungen

- Ubuntu/Debian VPS mit `sudo`-Rechten
- Repository liegt auf dem Server unter `/opt/worldview` (oder eigener Pfad via `REPO_DIR`)
- Vorheriger Zugriff getestet (mindestens ein funktionierender SSH-Key)

### Exakte Ausführungs-Reihenfolge

1. **Code auf den Server bringen und in Repo wechseln**

   ```bash
   sudo mkdir -p /opt/worldview
   sudo chown -R "$USER":"$USER" /opt/worldview
   cd /opt/worldview
   # Repo hier klonen oder aktualisieren
   ```

   Verifikation:

   ```bash
   test -f /opt/worldview/ops/server-hardening.sh && test -f /opt/worldview/tools/czml_generator.py && echo "OK: Dateien vorhanden"
   ```

2. **Skripte ausführbar setzen**

   ```bash
   cd /opt/worldview
   chmod +x ops/server-hardening.sh ops/deploy-worker.sh ops/rollback.sh
   ```

   Verifikation:

   ```bash
   ls -l ops/*.sh
   ```

3. **Trockenprüfung der SSH-Konfiguration vor Hardening**

   ```bash
   sudo sshd -t
   ```

   Verifikation:

   ```bash
   echo "OK: sshd -t erfolgreich"
   ```

4. **Grundhärtung ausführen (erst mit Passwort-Fallback, Lockout-sicher)**

   ```bash
   cd /opt/worldview
   sudo ALLOW_PASSWORD_FALLBACK=1 ./ops/server-hardening.sh
   ```

   Verifikation:

   ```bash
   sudo ufw status verbose
   sudo fail2ban-client status sshd
   sudo sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries|allowtcpforwarding'
   ```

5. **Zweiten SSH-Login testen (neue Session)**

   ```bash
   ssh <user>@91.99.184.153
   ```

   Verifikation:

   ```bash
   whoami && hostname && echo "OK: zweiter Login erfolgreich"
   ```

6. **Finale SSH-Härtung ohne Passwort-Login**

   ```bash
   cd /opt/worldview
   sudo ALLOW_PASSWORD_FALLBACK=0 ./ops/server-hardening.sh
   ```

   Verifikation:

   ```bash
   sudo sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin'
   ```

7. **CZML-Worker deployen (Python venv + systemd Unit/Timer)**

   ```bash
   cd /opt/worldview
   sudo REPO_DIR=/opt/worldview APP_USER=worldview APP_GROUP=worldview ./ops/deploy-worker.sh
   ```

   Verifikation:

   ```bash
   sudo systemctl status worldview-czml.service --no-pager -n 30
   sudo systemctl status worldview-czml.timer --no-pager -n 30
   sudo systemctl list-timers worldview-czml.timer --no-pager
   ```

8. **Output prüfen (Replay-Dateien wurden geschrieben)**

   ```bash
   ls -lah /opt/worldview/data/replay
   find /opt/worldview/data/replay -type f \( -name '*.czml' -o -name '*.json' \) | head
   ```

   Verifikation:

   ```bash
   test -d /opt/worldview/data/replay && echo "OK: replay output vorhanden"
   ```

9. **Persistenz nach Reboot validieren**

   ```bash
   sudo systemctl is-enabled worldview-czml.timer
   sudo systemctl cat worldview-czml.service
   sudo systemctl cat worldview-czml.timer
   ```

   Verifikation:

   ```bash
   sudo systemctl list-timers --all | grep worldview-czml.timer
   ```

10. **Rollback-Prozedur dokumentiert bereit halten (nur im Notfall)**

    ```bash
    cd /opt/worldview
    sudo ./ops/rollback.sh
    ```

    Verifikation:

    ```bash
    sudo ufw status verbose
    sudo sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries|allowtcpforwarding'
    ```

### Wichtige Hinweise

- `ops/server-hardening.sh` erstellt Backups in `/root/worldview-backups/<timestamp>` vor kritischen Änderungen.
- `ops/deploy-worker.sh` sichert bestehende systemd-Units ebenfalls nach `/root/worldview-backups/<timestamp>`.
- Bei Lockout-Risiko immer zuerst Konsole/Rescue-Zugang des Providers nutzen und danach `ops/rollback.sh` ausführen.

## Datenqualität & Replay-Validation

Datei: [`Worldview/ops/validate-replay.py`](Worldview/ops/validate-replay.py)

Der Validator prüft produktionsnah die CZML-Dateien unter `data/replay/*` auf:

- gültiges CZML-Array mit `document`-Packet
- `clock.interval`/`clock.currentTime` im ISO-UTC-Format
- eindeutige Entity-IDs
- konsistente `availability`-Intervalle
- `position.epoch` + `cartographicDegrees` (Vielfaches von 4, numerisch, sortiert, Lon/Lat-Bounds)

Ausführung:

```bash
cd Worldview
python3 ./ops/validate-replay.py --root . --fail-on-empty
```

oder per npm-Skript:

```bash
cd Worldview
npm run ops:validate-replay
```

## Observability & Healthchecks

Datei: [`Worldview/ops/healthcheck.sh`](Worldview/ops/healthcheck.sh)

Der Healthcheck prüft:

- Build-Artefakte (`dist/index.html`)
- Frische der letzten Replay-Datei (`data/replay/**/*.czml`)
- optional `systemd`-Service/Timer-Status (`worldview-czml.service`, `worldview-czml.timer`), falls auf Zielsystem vorhanden

Standardlauf:

```bash
cd Worldview
bash ./ops/healthcheck.sh
```

Optional schärfer (frische Replay-Datei erzwingen):

```bash
cd Worldview
REQUIRE_RECENT_REPLAY=1 MAX_REPLAY_AGE_MIN=120 bash ./ops/healthcheck.sh
```

oder per npm-Skript:

```bash
cd Worldview
npm run ops:healthcheck
```

## Backup & Recovery (Retention)

Datei: [`Worldview/ops/backup-replay.sh`](Worldview/ops/backup-replay.sh)

Erstellt tar+gzip-Backups von `data/replay` und entfernt alte Archive gemäß Retention.

Standardlauf (Retention 14 Tage):

```bash
cd Worldview
bash ./ops/backup-replay.sh
```

Mit angepasster Retention/Zielpfad:

```bash
cd Worldview
RETENTION_DAYS=30 BACKUP_DIR="./data/backups/replay" bash ./ops/backup-replay.sh
```

oder per npm-Skript:

```bash
cd Worldview
npm run ops:backup-replay
```

Recovery-Hinweis:

```bash
mkdir -p /tmp/worldview-replay-restore
tar -xzf ./data/backups/replay/replay-YYYYMMDDTHHMMSSZ.tar.gz -C /tmp/worldview-replay-restore
```

## Staging->Production Gate

Datei: [`Worldview/ops/staging-gate.sh`](Worldview/ops/staging-gate.sh)

Das Gate führt lokal in fixer Reihenfolge aus:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. Replay-Validation via `ops/validate-replay.py --fail-on-empty`

Ausführung:

```bash
cd Worldview
bash ./ops/staging-gate.sh
```

oder per npm-Skript:

```bash
cd Worldview
npm run ops:staging-gate
```

## Post-Go-Live Betriebsrhythmus

Empfohlener Rhythmus für den Betrieb (ohne SSH-Änderungen am System):

- **Alle 6h**: [`bash ./ops/healthcheck.sh`](Worldview/ops/healthcheck.sh)
- **Täglich**: [`bash ./ops/backup-replay.sh`](Worldview/ops/backup-replay.sh)
- **Vor jedem Release**: [`bash ./ops/staging-gate.sh`](Worldview/ops/staging-gate.sh)
- **Nach jedem Replay-Generator-Update**: [`python3 ./ops/validate-replay.py --root . --fail-on-empty`](Worldview/ops/validate-replay.py)
- **Wöchentlich**: Backup-Ordnergröße prüfen, Retention anpassen, Recovery-Test per Entpacken eines aktuellen Archives durchführen

Hinweis: Für alle neuen Shell-Skripte einmalig Executable-Bit setzen:

```bash
cd Worldview
chmod +x ./ops/backup-replay.sh ./ops/healthcheck.sh ./ops/staging-gate.sh
```

## Umgesetzte Kernpunkte

- Viewer + Kamera-Presets + Layer-Toggle
- Shader: CRT/NVG/FLIR mit Intensitäts-Slider
- CZML Multi-Part + incremental processing
- Clustering für ADS-B Replay
- Live-Poller (Celestrak/OpenSky) mit Fallback/Rate-Limit-Handling
- Offline-/Online-Health-Status
- Replay-CZML Export im UI
- Attribution-Hinweise im UI

## Wichtige Dateien

- App-Entry: [`Worldview/src/main.ts`](Worldview/src/main.ts)
- UI-Markup: [`Worldview/index.html`](Worldview/index.html)
- Styling: [`Worldview/src/style.css`](Worldview/src/style.css)
- Env-Typen: [`Worldview/src/vite-env.d.ts`](Worldview/src/vite-env.d.ts)
