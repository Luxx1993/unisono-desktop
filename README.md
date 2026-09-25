# Scribe Studio

UI-Tool zum Hochladen, Transkribieren und Bearbeiten von Audioaufnahmen – als **eine einzige HTML-Datei**, die komplett im Browser läuft (BYOK: *Bring Your Own Key*).

- **Keine Zwischenserver:** Der Browser spricht direkt mit den APIs von Gladia, ElevenLabs und AssemblyAI.
- **Keine laufenden Kosten:** Es fallen nur die API-Gebühren der Anbieter an.
- **Datenschutz:** API-Schlüssel liegen ausschließlich im `localStorage` deines Browsers (per Button löschbar).

## Nutzung

1. `index.html` herunterladen und im Browser öffnen (Doppelklick genügt).
2. API-Schlüssel eintragen und speichern.
3. Anbieter, Modell und Sprache wählen, optional Sprechererkennung und Sprecheranzahl einstellen, Audiodatei per Drag & Drop hinzufügen, **Transkription starten**.
4. Ergebnis im Textfeld korrigieren und als TXT, SRT (mit Zeitstempeln und Sprechern) oder JSON (Rohdaten) exportieren.
5. Optional: Mit einem Anthropic- oder OpenAI-Key per Klick Stichpunkte, eine Zusammenfassung oder ein Protokoll erzeugen lassen.

Mit Sprechererkennung sieht das Transkript so aus:

```
[Sprecher A - 00:01:12]: Hallo, wie geht es dir?
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

## Hinweise

- Tailwind CSS und Font Awesome werden per CDN geladen – für die Oberfläche ist eine Internetverbindung nötig (die sowieso für die APIs gebraucht wird).
- Schlägt eine Anfrage mit „Netzwerk- oder CORS-Fehler“ fehl, blockiert der Anbieter direkte Browser-Anfragen oder der Key ist ungültig.
- API-Keys im Browser sind nur für den eigenen, privaten Gebrauch gedacht – die Seite nicht mit eingetragenen Keys öffentlich hosten.
