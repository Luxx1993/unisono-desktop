# Scribe Studio

UI-Tool zum Hochladen, Transkribieren und Bearbeiten von Audioaufnahmen – als **eine einzige HTML-Datei**, die komplett im Browser läuft (BYOK: *Bring Your Own Key*).

- **Keine Zwischenserver:** Der Browser spricht direkt mit den APIs von Gladia, ElevenLabs und AssemblyAI.
- **Keine laufenden Kosten:** Es fallen nur die API-Gebühren der Anbieter an.
- **Datenschutz:** API-Schlüssel liegen ausschließlich im `localStorage` deines Browsers (per Button löschbar).

## Nutzung

1. `index.html` herunterladen und im Browser öffnen (Doppelklick genügt).
2. API-Schlüssel eintragen und speichern.
3. Anbieter, Modell und Sprache wählen, Audiodatei per Drag & Drop hinzufügen, **Transkription starten**.
4. Ergebnis im Textfeld korrigieren und als TXT, SRT (mit Zeitstempeln und Sprechern) oder JSON (Rohdaten) exportieren.

## Anbieter & Modelle

| Anbieter | Modelle | Ablauf |
|---|---|---|
| Gladia (v2) | `solaria-3` (DE/EN/FR/ES/IT, feste Sprache nötig), `solaria-1` (100+ Sprachen) | Upload → `/v2/pre-recorded` → Polling |
| ElevenLabs (Scribe) | `scribe_v2`, `scribe_v1` | Synchroner Upload an `/v1/speech-to-text` |
| AssemblyAI (v2) | `universal-3-5-pro`, `universal-2` | Upload → `/v2/transcript` → Polling |

Sprechererkennung (Diarization) ist bei allen Anbietern aktivierbar.

## Hinweise

- Tailwind CSS und Font Awesome werden per CDN geladen – für die Oberfläche ist eine Internetverbindung nötig (die sowieso für die APIs gebraucht wird).
- Schlägt eine Anfrage mit „Netzwerk- oder CORS-Fehler“ fehl, blockiert der Anbieter direkte Browser-Anfragen oder der Key ist ungültig.
- API-Keys im Browser sind nur für den eigenen, privaten Gebrauch gedacht – die Seite nicht mit eingetragenen Keys öffentlich hosten.
