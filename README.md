# Scribe Studio

UI-Tool zum Hochladen, Transkribieren und Bearbeiten von Audioaufnahmen – komplett im Browser, ohne eigenen Server (BYOK: *Bring Your Own Key*).

- **Keine Zwischenserver:** Der Browser spricht direkt mit den APIs von Gladia, ElevenLabs und AssemblyAI.
- **Keine laufenden Kosten:** Es fallen nur die API-Gebühren der Anbieter an.
- **Datenschutz:** API-Schlüssel liegen ausschließlich im `localStorage` deines Browsers (per Button löschbar).

## Nutzung

1. Repository herunterladen (*Code → Download ZIP*) und `index.html` im Browser öffnen – Doppelklick genügt, ein Server ist nicht nötig.
2. API-Schlüssel eintragen und speichern.
3. Anbieter, Modell und Sprache wählen, optional Sprechererkennung und Sprecheranzahl einstellen, Audiodatei per Drag & Drop hinzufügen, **Transkription starten**.
4. Transkript im Segment-Editor korrigieren (siehe unten) und als TXT, SRT, VTT oder JSON exportieren.
5. Optional: Mit einem Anthropic- oder OpenAI-Key per Klick Stichpunkte, eine Zusammenfassung oder ein Protokoll erzeugen lassen.

## Fachbegriffe

In der Karte **Fachbegriffe** pflegst du eine Liste mit Namen, Firmen, Fachwörtern und Abkürzungen (ein Begriff pro Zeile, Zeilen mit `#` sind Kommentare). Die Liste bleibt im Browser gespeichert, lässt sich als `.txt` exportieren und aus `.txt`/`.csv` importieren. Bei jeder Transkription wird sie im jeweils passenden Format mitgeschickt:

| Anbieter | Parameter | Grenzen |
|---|---|---|
| Gladia | `custom_vocabulary_config` | – |
| ElevenLabs | `keyterms` (nur Scribe v2) | max. 100 Begriffe à 50 Zeichen, ca. 30 % Aufpreis |
| AssemblyAI | `keyterms_prompt` (Universal-3.5 Pro), `word_boost` (Universal-2) | max. 1.000 Begriffe à 6 Wörter |
| Deepgram | `keyterm` (Nova-3), `keywords` (Nova-2, nur Einzelwörter) | max. 100 Begriffe |

Unter der Liste steht, wie viele Begriffe beim gewählten Anbieter ankommen und welche wegen der Grenzen übersprungen werden.

## Segment-Editor

Das Transkript besteht aus Abschnitten (Segmenten) mit Sprecher, Zeitstempel und Text:

- **Sprecher umbenennen:** In der Sprecherleiste über dem Transkript z. B. „Sprecher A“ in „Herr Müller“ ändern – alle Abschnitte dieses Sprechers ändern sich sofort mit.
- **Sprecher zuordnen:** Pro Abschnitt über das Auswahlfeld einen anderen oder neuen Sprecher wählen.
- **Text korrigieren:** Direkt im Abschnitt tippen.
- **Zusammenführen / Löschen:** Über die Symbole rechts im Abschnitt.
- **Click-to-Jump:** Klick auf den Zeitstempel springt im Player an diese Stelle. Der gerade gesprochene Abschnitt wird hervorgehoben („Mitlaufen“ scrollt automatisch mit).
- **Automatisch gespeichert:** Das bearbeitete Transkript bleibt nach einem Neuladen der Seite erhalten. Die Audiodatei selbst wird nicht gespeichert und muss für den Player erneut geladen werden.

Alle Exporte und die KI-Zusammenfassung verwenden den bearbeiteten Stand. Format der Textausgabe:

```
[Herr Müller - 00:01:12]: Hallo, wie geht es dir?
```

## Anbieter & Modelle

| Anbieter | Modelle | Ablauf |
|---|---|---|
| Gladia (v2) | `solaria-3` (DE/EN/FR/ES/IT, feste Sprache nötig), `solaria-1` (100+ Sprachen) | Upload → `/v2/pre-recorded` → Polling |
| ElevenLabs (Scribe) | `scribe_v2`, `scribe_v1` | Synchroner Upload an `/v1/speech-to-text` |
| AssemblyAI (v2) | `universal-3-5-pro`, `universal-2` | Upload → `/v2/transcript` → Polling |
| Deepgram | `nova-3`, `nova-2` | Synchroner Upload an `/v1/listen` (**nur über Proxy**, siehe unten) |

Sprechererkennung (Diarization) ist bei allen Anbietern aktivierbar.

### KI-Zusammenfassung

| Anbieter | Modelle (frei änderbar) | Hinweis |
|---|---|---|
| Anthropic | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` | Direktzugriff aus dem Browser über den Header `anthropic-dangerous-direct-browser-access` |
| OpenAI | `gpt-5`, `gpt-5-mini` | Chat Completions API |

Zusammengefasst wird immer der aktuelle (ggf. von dir korrigierte) Text im Ergebnisfeld.

## Deepgram-Proxy

Deepgram erlaubt keine direkten Browser-Anfragen an seine REST-API (fehlende CORS-Header). Deshalb braucht Deepgram einen kleinen Proxy. Im Ordner [`deepgram-proxy/`](deepgram-proxy/worker.js) liegt eine fertige Vorlage für einen **Cloudflare Worker** (kostenloser Tarif reicht):

1. Im Cloudflare-Dashboard unter *Workers & Pages* einen neuen Worker anlegen und den Inhalt von `worker.js` einfügen.
2. Optional die Variable `ALLOWED_ORIGIN` setzen, damit nur deine Seite den Proxy nutzen darf.
3. Die Worker-URL (z. B. `https://scribe-proxy.<dein-name>.workers.dev`) in Scribe Studio als *Deepgram Proxy-URL* eintragen.

Der Proxy speichert nichts. Der API-Key bleibt in deinem Browser und wird nur durchgereicht.

## Projektstruktur

```
index.html              Layout
css/styles.css          Komponenten-Styles (Karten, Felder, Segment-Editor, Sprecherfarben)
js/state.js             Zentraler State: Segmente, Sprecher, Rohdaten, Autosave
js/segment-editor.js    Darstellung und Bearbeitung der Segmente, Player-Sync
js/export.js            TXT, SRT, VTT, JSON aus dem bearbeiteten Stand
js/vocabulary.js        Fachbegriffsliste: Pflege, Speicherung, Import/Export, Anbieter-Grenzen
js/summary.js           KI-Zusammenfassung (Anthropic / OpenAI)
js/app.js               Keys, Konfiguration, Datei-Upload, Ablauf der Transkription
js/apis/common.js       Gemeinsame HTTP- und Polling-Helfer
js/apis/*.js            Je ein Modul pro Anbieter (Gladia, ElevenLabs, AssemblyAI, Deepgram)
deepgram-proxy/         Cloudflare-Worker-Vorlage für Deepgram
```

Die Skripte werden bewusst als klassische `<script defer>`-Dateien geladen und nicht als ES-Module: Browser blockieren ES-Module, wenn eine Seite per Doppelklick (`file://`) geöffnet wird. Die Module teilen sich das globale Objekt `window.Scribe`. Ein neuer Anbieter wird als Datei unter `js/apis/` angelegt, registriert sich in `Scribe.apis` und in `index.html` eingebunden.

## Hinweise

- Tailwind CSS und Font Awesome werden per CDN geladen – für die Oberfläche ist eine Internetverbindung nötig (die sowieso für die APIs gebraucht wird).
- Schlägt eine Anfrage mit „Netzwerk- oder CORS-Fehler“ fehl, blockiert der Anbieter direkte Browser-Anfragen oder der Key ist ungültig.
- API-Keys im Browser sind nur für den eigenen, privaten Gebrauch gedacht – die Seite nicht mit eingetragenen Keys öffentlich hosten.
