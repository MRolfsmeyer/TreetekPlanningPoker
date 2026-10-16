# Treetek Planning Poker

Planning Poker mit dem Treetek-Kartensatz: verdeckt wählen, gemeinsam mit Countdown aufdecken, Ergebnis mit Einigkeit und Spannweite, Signalkarten (?, KI, II, 21, 40), ELMO, Verlauf, 100 Tipps & Tricks sowie QR-Code und „Link kopieren“ zum schnellen Mitspielen per Handy.

Dieses Paket läuft **ohne claude.ai**: Ein kleiner Node.js-Server liefert die Seite aus und gleicht die Tische live zwischen allen Teilnehmenden ab. Auf der Startseite legt man einen Tisch an oder tritt mit einem Code bei. Mehrere Teams können parallel spielen, jeder Tisch ist mit bis zu 16 Personen getestet.

---

## So funktioniert es

1. **Startseite** (`/`): Namen eingeben, dann wählen:
   - **Neuen Tisch erstellen** (Teamname optional) → „Tisch erstellen“
   - **Tisch beitreten** → sechsstelligen Code eingeben → „Tisch beitreten“

   In beiden Fällen sitzt man danach direkt am Tisch, ohne zweite Namensabfrage.
2. Jeder Tisch hat einen **eigenen Link** (`/t/ABC234`) und einen **sechsstelligen Code**. Link, QR-Code und Code stehen oben am Tisch. Wer über Link oder QR-Code kommt, gibt seinen Namen direkt am Tisch ein.
3. Wer den Tisch erstellt, **moderiert** ihn. Mitschätzen geht trotzdem, Moderation ist keine Rolle wie PO oder SM.

### Rechte

| Aktion | Wer darf das? |
|---|---|
| Aufdecken | Moderation |
| Neue Runde, Runde zurücksetzen | Moderation |
| alle Runden zurücksetzen | Moderation |
| Weitere Personen zur Moderation machen, Moderation entziehen oder abgeben | Moderation (Klick auf einen Platz am Tisch) |
| Story eintragen und ändern | alle am Tisch |
| Karte wählen, ELMO ziehen, Rolle wechseln | jede Person für sich selbst |

Der **Server prüft diese Rechte selbst**. Ein ausgeblendeter Knopf lässt sich also nicht über die Entwicklertools des Browsers wieder nutzbar machen.

### Moderationslink

Beim Starten bekommt der Tisch einen geheimen Moderationsschlüssel. Er wird im Browser der startenden Person gespeichert und aus der Adresszeile entfernt. Über **„Moderationslink kopieren“** (unter dem QR-Code) holst du dir die Rechte auf einem anderen Gerät zurück. Den Moderationslink nicht ins Team teilen, dafür gibt es „Link kopieren“.

Wer den Schlüssel hat, bekommt die Moderation beim Öffnen des Tisches immer zurück, auch nach „Moderation abgeben“. So kann ein Tisch nie ohne Moderation hängen bleiben.

Auf der Startseite stehen unter **„Deine Tische auf diesem Gerät“** alle Tische, die in diesem Browser gestartet wurden.

---

## Inhalt

| Datei / Ordner | Zweck |
|---|---|
| `server.js` | Server: liefert die Seite, gleicht den Tisch per WebSocket ab, speichert ihn in einer JSON-Datei |
| `public/` | Die fertigen Seiten (`landing.html` = Startseite, `index.html` = Tisch), Verbindung zum Server (`claude-shim.js`), Schriften, Kartenbilder |
| `vendor/ws/` | WebSocket-Bibliothek, beigelegt, damit der Start ohne Installation und ohne Internet klappt |
| `src/app.html` | Quelle des Tisches, identisch mit der claude.ai-Version |
| `src/landing.html`, `src/landing-assets.json` | Quelle der Startseite, Markenbilder |
| `tools/build-page.js` | Baut die Seiten in `public/` aus `src/` |
| `Start-Windows.bat`, `start-mac-linux.command` | Start per Doppelklick |
| `Dockerfile`, `render.yaml` | Betrieb auf einem Server oder in der Cloud |
| `.github/workflows/build-exe.yml` | Baut auf Wunsch die Windows-.exe auf GitHub |

---

## 1. Lokal starten (Demo, auch ohne Internet)

Voraussetzung ist **Node.js** (LTS-Version von <https://nodejs.org>, einmalig installieren). Node.js ist digital signiert und wird deshalb nicht von Windows blockiert.

- **Windows:** `Start-Windows.bat` doppelklicken.
- **Mac:** `start-mac-linux.command` doppelklicken (beim ersten Mal: Rechtsklick → Öffnen).
- **Terminal:** `node server.js`

Der Browser öffnet `http://localhost:3000` mit der Startseite. Im Fenster steht außerdem ein Link wie `http://192.168.x.x:3000`, über den andere im **selben WLAN** mitspielen. Der QR-Code oben rechts am Tisch zeigt automatisch diese Netzwerkadresse inklusive Tisch, nicht „localhost“. So können Handys im selben WLAN direkt scannen. Jeder Browser-Tab ist eine eigene Person, du kannst also auch allein mit mehreren Tabs vorführen.

Alle Tische werden in `planning-poker-daten.json` gespeichert und überstehen einen Neustart. Datei löschen = alle Tische weg. Tische, die 30 Tage nicht genutzt wurden, räumt der Server selbst ab.

---

## 2. Auf GitHub ablegen

**Variante A, im Browser (ohne Git-Kenntnisse):**
1. Auf github.com oben rechts **+ → New repository**, Name z. B. `treetek-planning-poker`, **Private** wählen, **Create repository**.
2. Auf der leeren Repo-Seite **uploading an existing file** anklicken.
3. Den **Inhalt** dieses Ordners (nicht den Ordner selbst) ins Fenster ziehen, inklusive `.github`. Unter macOS zeigt der Finder versteckte Ordner mit `Cmd + Shift + .`.
4. **Commit changes**.

**Variante B, mit Git:**
```bash
cd treetek-planning-poker
git init
git add .
git commit -m "Treetek Planning Poker"
git branch -M main
git remote add origin https://github.com/<organisation>/treetek-planning-poker.git
git push -u origin main
```

---

## 3. Auf einen Server bringen, damit der Link einfach funktioniert

### Option A: Render (am schnellsten, kostenlos testbar)

1. Auf <https://render.com> mit dem GitHub-Konto anmelden.
2. **New → Blueprint** → das Repository auswählen. Render liest `render.yaml`.
3. Render fragt nach `ACCESS_PASSWORD`: Passwort eintragen (empfohlen) oder leer lassen.
4. **Apply**. Nach ein bis zwei Minuten gibt es einen Link wie `https://treetek-planning-poker.onrender.com`.

Zum kostenlosen Tarif: Die Instanz schläft nach 15 Minuten ohne Besuch ein und braucht beim nächsten Aufruf etwa 30 Sekunden zum Aufwachen. Außerdem gehen die gespeicherten Tische (Verlauf, Codes) bei einem Neustart verloren. Für den Dauerbetrieb einen bezahlten Tarif mit **Disk** wählen und `DATA_FILE=/var/data/planning-poker-daten.json` setzen.

### Option B: Eigener Server mit Docker (z. B. Treetek-intern)

```bash
docker build -t treetek-planning-poker .
docker run -d --name planning-poker --restart unless-stopped \
  -p 3000:3000 \
  -e ACCESS_PASSWORD='ein-gutes-passwort' \
  -v planning-poker-daten:/data \
  treetek-planning-poker
```

Die Tische liegen im Volume `planning-poker-daten` und übersteht Updates und Neustarts.

Für HTTPS und eine eigene Adresse (z. B. `poker.treetek.de`) einen Reverse Proxy davorsetzen. Wichtig sind die Upgrade-Header für den Live-Abgleich:

```nginx
server {
  listen 443 ssl;
  server_name poker.treetek.de;
  # ssl_certificate ... / ssl_certificate_key ...

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }
}
```

### Option C: Server ohne Docker

Node.js 18 oder neuer installieren, Ordner hochladen, dann:
```bash
NO_BROWSER=1 ACCESS_PASSWORD='ein-gutes-passwort' node server.js
```
Für den Dauerbetrieb über einen Dienst starten (systemd, pm2 o. Ä.).

---

## 4. Einstellungen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers. Ist er gesetzt, öffnet sich kein Browser. |
| `ACCESS_PASSWORD` | leer | Zugang nur mit Passwort. Der Browser fragt einmal danach, der Benutzername ist beliebig. |
| `DATA_FILE` | neben `server.js` | Speicherort der Tische |
| `NO_BROWSER` | leer | `1` = beim Start keinen Browser öffnen |

Prüfadresse für Monitoring: `/health` antwortet mit `ok`, auch bei aktivem Passwort.

Der QR-Code nutzt auf einem Server die Adresse, unter der der Tisch aufgerufen wird (z. B. `https://poker.treetek.de/t/ABC234`). Beim lokalen Start nutzt er die Netzwerkadresse des Rechners.

---

## 5. Sicherheit

- **Ohne `ACCESS_PASSWORD`** kann jede Person Tische anlegen und mitspielen, die die Adresse erreicht. Fremde Tische findet man nur mit dem Code. Im lokalen Netz für Demos in Ordnung, im Internet immer ein Passwort setzen.
- **Verdeckte Karten** liegen bis zum Aufdecken in einem privaten Bereich, den nur die Person selbst lesen kann. Der Server lässt außerdem niemanden den Platz einer anderen Person ändern und erlaubt Aufdecken, Runden und Zurücksetzen nur der Moderation.
- **Identität:** Jeder Browser-Tab hat einen geheimen Schlüssel, aus dem der Server die öffentliche Kennung ableitet. Wer nur die Kennung einer anderen Person kennt (sie ist am Tisch sichtbar), kann sich damit nicht als diese Person ausgeben.
- **Moderationsschlüssel** speichert der Server nur als Prüfsumme (SHA-256).
- **Speichern:** Die Datendatei wird erst als temporäre Datei geschrieben und dann umbenannt. Ist sie beim Start beschädigt, legt der Server sie als `…defekt-<Zeit>.json` beiseite, statt sie zu überschreiben.
- Es werden **keine personenbezogenen Daten** außer den selbst gewählten Anzeigenamen gespeichert.

---

## 6. App ändern

1. Änderungen am Tisch in `src/app.html` vornehmen (oder die neue Version aus claude.ai dort einfügen), an der Startseite in `src/landing.html`.
2. Einmalig `npm install`, danach `npm run build:page`. Das erzeugt `public/index.html`, `public/landing.html` und die Kartenbilder in `public/cards/` neu.
3. Committen und pushen. Render baut automatisch neu, bei Docker `docker build` und den Container neu starten.
4. **claude.ai-Version mitziehen:** Der Tisch auf claude.ai (Artifact „Treetek Planning Poker“) ist genau `src/app.html`. Nach jeder Änderung an `src/app.html` das Artifact mit dieser Datei neu veröffentlichen, damit beide Versionen gleich bleiben. Die Startseite (`src/landing.html`) gibt es nur in der Server-Version: Auf claude.ai ist der Link selbst der Tisch.

---

## 7. Windows-.exe (optional)

Auf GitHub: Reiter **Actions → Windows-Programm bauen → Run workflow**. Nach etwa drei Minuten liegt die .exe im Lauf unter **Artifacts**. Lokal geht es mit `npm install` und `npm run build:exe`.

Hinweis: Die .exe ist nicht signiert. Windows (SmartScreen bzw. Smart App Control) kann sie deshalb blockieren. Für Vorführungen ist `Start-Windows.bat` mit installiertem Node.js der zuverlässigere Weg. Für eine verteilbare .exe bräuchte Treetek ein Code-Signing-Zertifikat.

---

## 8. Grenzen

- Bis zu 1.000 Tische pro Server, je Tisch bis zu 20 Moderierende.
- Die Daten liegen in einer JSON-Datei, eine Datenbank ist nicht nötig.
- Der Kartensatz hat 5 Rückseiten, ab der 6. Person wiederholen sich die Satzfarben.
