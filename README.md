# Unisono

Audio und Video transkribieren, lesen, korrigieren und exportieren, komplett im Browser, ohne Installation und ohne eigenen Server. Du bringst deine eigenen API-Keys mit (BYOK: *Bring Your Own Key*), die Datei geht direkt vom Browser zur gewählten Engine.

<img src="docs/screenshots/transcript.png" alt="Transkript mit einfarbiger Wellenform, Sprecherspur, Redezeit und Zusammenfassung" width="100%">

## Auf einen Blick

- **Läuft einfach so:** `index.html` per Doppelklick öffnen. Kein Node.js, kein Server, keine Installation, keine Verbindung zu Google Fonts. Ideal für Dienstrechner.
- **Vier Engines:** Gladia, ElevenLabs (Scribe), AssemblyAI und Mistral (Voxtral), jeweils mit Sprechererkennung.
- **Aufnehmen im Browser:** Mikrofonaufnahme mit Pause, Pegelanzeige und Absturzsicherung.
- **Fachbegriffe:** eine Liste mit Namen und Fachwörtern, die in passender Form an jede Engine geht.
- **Live-Fortschritt:** Hochladen mit echtem Prozentwert und Tempo, Verarbeitungszeit, jederzeit abbrechbar.
- **Player:** einfarbige Wellenform, darunter die Sprecherspur. Klicken oder ziehen zum Springen.
- **Redezeit:** ein geteilter Balken plus Minuten und Prozent je Sprecher, dazu die Pausen.
- **Suchen und Ersetzen:** Treffer markiert im Text, nur Treffer anzeigen, einzeln oder alle ersetzen.
- **Segment-Editor:** Sprecher umbenennen und zuordnen, Text korrigieren, Abschnitte zusammenführen, mitlaufender Player.
- **Export:** HTML-Seite (mit Audio, als PDF druckbar), Markdown, Text, SRT/VTT und Projektdatei zum Weiterbearbeiten.
- **Zusammenfassung:** Stichpunkte, Zusammenfassung oder Protokoll mit Aufgaben über Anthropic (Claude) oder OpenAI.
- **Hell und Dunkel,** fest oder wie im Betriebssystem eingestellt.
- **Datenschutz:** Keys, Transkript und Einstellungen bleiben in deinem Browser und lassen sich dort jederzeit löschen.

## Schnellstart

1. Repository herunterladen (*Code → Download ZIP*), entpacken und `index.html` im Browser öffnen.
2. Beim ersten Start öffnet sich **API-Keys**. Mindestens einen Key eintragen und mit **Prüfen** testen. Das zeigt auch, ob der Anbieter Anfragen direkt aus dem Browser zulässt.
3. Unter **Neue Transkription** eine Datei ablegen oder aufnehmen, die Engine wählen (unter **Optionen** Modell, Sprache und Sprecher) und **Mit … transkribieren**.
4. Unter **Transkript** korrigieren, Sprecher benennen, zusammenfassen lassen und exportieren.

<img src="docs/screenshots/start.png" alt="Neue Transkription: Datei, Aufnahme, Engine-Auswahl" width="100%">

## Aufbau

Links steht die Seitenleiste (auf dem Handy eine Tab-Leiste unten):

| Seite | Inhalt |
|---|---|
| **Neue Transkription** | Datei ablegen oder aufnehmen, Engine wählen, Optionen, Start. Während des Laufs der Fortschritt. |
| **Transkript** | Player, Transkript-Editor, Suche, Sprecher und Redezeit, Zusammenfassung, Export. |
| **Fachbegriffe** | Begriffsliste mit Import und Export. |
| **API-Keys** | Keys für die Engines und die Zusammenfassung, jeweils mit **Prüfen**, **Entfernen** und der Anleitung „So bekommst du einen Key“. |
| **Einstellungen** | Darstellung (Hell, Dunkel, Wie System) sowie Daten und Datenschutz: Keys, Transkript und Aufnahme-Sicherung einzeln löschen oder alles zurücksetzen. |

Unten in der Seitenleiste steht, für welche Engine ein Key hinterlegt ist.

<img src="docs/screenshots/keys.png" alt="API-Keys mit Status, Prüfen und Anleitung" width="100%">

## Fortschritt während der Transkription

Nach dem Start zeigt Unisono die Schritte *Vorbereiten → Hochladen → Verarbeiten → Fertig*:

- **Hochladen** mit echtem Prozentwert, übertragenen MB, Tempo und geschätzter Restzeit – bei 50-MB-Besprechungen sieht man, dass es vorangeht.
- **Verarbeiten** mit der Zeit, die der Anbieter schon rechnet.
- **Abbrechen** stoppt Upload oder Warten sofort. Was schon beim Anbieter liegt, löscht er nach seinen eigenen Regeln.
- Solange eine Transkription läuft, warnt der Browser vor dem Schließen des Tabs.

<img src="docs/screenshots/progress.png" alt="Fortschrittsanzeige beim Hochladen" width="100%">

## Player, Sprecherspur und Redezeit

- **Wellenform:** einfarbig, der gespielte Teil dunkler. Darunter die **Sprecherspur**: ein Balken je Redeabschnitt in der Graustufe des Sprechers. Die Abspielposition läuft als Linie durch beide. Klicken oder ziehen springt an die Stelle, beim Überfahren stehen Zeit, Kürzel und Sprecher; mit dem Fokus auf der Zeitleiste springen ← / → um 5 Sekunden.
- **Bedienung:** Abspielen/Pause, 10 Sekunden zurück/vor, Geschwindigkeit 0,75× bis 2×, **Mitlaufen** scrollt zum gerade gesprochenen Abschnitt.
- **Ohne Audiodatei** (etwa nach dem Neuladen oder beim Öffnen einer Projektdatei) bleibt die Sprecherspur; ein Klick springt zum passenden Abschnitt im Text.
- **Sprecher:** Jeder Sprecher hat ein Kürzel aus zwei Buchstaben (z. B. „Bauleitung LBB“ → BL), das in Spur, Transkript und Redezeit gleich erscheint. Die vier Graustufen wiederholen sich ab dem fünften Sprecher, dann unterscheiden die Kürzel. Farbe steht in Unisono nur für eine Engine oder einen Status.
- **Redezeit:** ein geteilter Balken, darunter je Sprecher Minuten und Prozent, dazu die **Pausen**. Das zeigt, wer die Besprechung geprägt hat – und verrät, wenn die Erkennung eine Person in zwei Sprecher aufgeteilt hat (ein „Sprecher“ mit 1 %).
- **Wellenform auch bei langen Aufnahmen:** WAV wird blockweise gelesen, MP3 stückweise dekodiert (2:40 h WAV in etwa 1 s, 70 min MP3 in etwa 4 s). M4A, WebM und OGG müssten Browser komplett in den Speicher dekodieren; dort gibt es die Wellenform bis 20 Minuten, bei längeren Dateien die Sprecherspur.

## Suchen & Ersetzen

Über dem Transkript (oder mit **Strg+F** bzw. **⌘F**):

- Treffer werden direkt im Text markiert, **Enter** / **Umschalt+Enter** springt zum nächsten / vorigen.
- **Nur Treffer** blendet alle anderen Abschnitte aus.
- **Ersetzen** ändert den aktuellen Treffer, **Alle ersetzen** alle – praktisch, wenn der Anbieter einen Namen immer gleich falsch schreibt. Groß- und Kleinschreibung spielt beim Suchen keine Rolle.

<img src="docs/screenshots/search.png" alt="Suchen und Ersetzen im Transkript" width="100%">

## Mikrofonaufnahme

Mit **Aufnehmen** unter „Neue Transkription“ nimmst du Diktate oder Besprechungen direkt im Browser auf – mit Pause/Weiter, Zeitanzeige und Pegelanzeige. Ein roter Punkt zeigt die laufende Aufnahme. Während der Aufnahme bleibt der Bildschirm an (wo der Browser das erlaubt). Nach **Stopp** wird die Aufnahme wie eine hochgeladene Datei behandelt: Sie liegt im Player und kann transkribiert oder über **Sichern** als Audiodatei gespeichert werden.

- Format: Opus/WebM (Chrome, Edge, Firefox) bzw. AAC/M4A (Safari), ca. 0,5 MB pro Minute.
- Der Browser fragt beim ersten Mal nach der Mikrofon-Freigabe.
- **Absturzsicher:** Während der Aufnahme wird jede Sekunde im Browser (IndexedDB) gesichert. Wird der Tab geschlossen, neu geladen oder vom Handy beendet, bietet Unisono beim nächsten Öffnen an, die unterbrochene Aufnahme wiederherzustellen. Nach einem normalen Stopp wird die Sicherung gelöscht.
- Beim Schließen des Tabs warnt der Browser, solange eine Aufnahme läuft oder eine fertige Aufnahme weder transkribiert noch gesichert wurde.
- Im privaten Modus mancher Browser ist keine Sicherung möglich; die App weist beim Start der Aufnahme darauf hin.

## Grenzen der Anbieter

Vor dem Upload prüft Unisono Dateigröße und Länge gegen die Grenzen des gewählten Anbieters und schlägt passende Alternativen vor – so schlägt nichts erst nach einem langen Upload fehl.

| Anbieter | Max. Dateigröße | Max. Länge |
|---|---|---|
| Gladia | 1.000 MB | 2:15 h (Enterprise: 4:15 h) |
| ElevenLabs | 3 GB | 10 h |
| AssemblyAI | 2,2 GB | 10 h |
| Mistral | keine Vorabprüfung | keine Vorabprüfung |

Besprechungen von 1–2 Stunden (typisch 40–60 MB) passen bei allen Anbietern.

## Fachbegriffe

Unter **Fachbegriffe** pflegst du eine Liste mit Namen, Firmen, Fachwörtern und Abkürzungen (ein Begriff pro Zeile, Zeilen mit `#` sind Kommentare). Die Liste bleibt im Browser gespeichert, lässt sich als `.txt` exportieren und aus `.txt`/`.csv` importieren. Bei jeder Transkription wird sie im jeweils passenden Format mitgeschickt:

| Anbieter | Parameter | Grenzen |
|---|---|---|
| Gladia | `custom_vocabulary_config` | – |
| ElevenLabs | `keyterms` (nur Scribe v2) | max. 100 Begriffe à 50 Zeichen, ca. 30 % Aufpreis |
| AssemblyAI | `keyterms_prompt` (Universal-3.5 Pro), `word_boost` (Universal-2) | max. 1.000 Begriffe à 6 Wörter |
| Mistral | `context_bias` | max. 100 Begriffe (für Deutsch laut Mistral noch experimentell) |

Unter „Neue Transkription“ steht, wie viele Begriffe bei der gewählten Engine ankommen und welche wegen der Grenzen übersprungen werden.

<img src="docs/screenshots/vocab.png" alt="Fachbegriffe" width="720">

## Segment-Editor

Das Transkript besteht aus Abschnitten (Segmenten) mit Sprecher, Zeitstempel und Text. Viele Anbieter – besonders Gladia – liefern sehr kleine Bruchstücke („Ja,“ / „gut.“). Unisono fasst direkt aufeinanderfolgende Bruchstücke desselben Sprechers automatisch zu Absätzen zusammen (Pause ≤ 2 s, Absatz ≤ 60 s); der Text bleibt dabei vollständig erhalten.

- **Sprecher umbenennen:** Unter „Sprecher und Redezeit“ z. B. „Sprecher A“ in „Projektleitung“ ändern . Alle Abschnitte dieses Sprechers und das Kürzel ändern sich sofort mit. Über **Sprecher** kommt ein weiterer hinzu.
- **Sprecher zuordnen:** Pro Abschnitt auf das Sprecherlabel klicken und einen anderen Sprecher wählen.
- **Text korrigieren:** Direkt im Abschnitt tippen.
- **Zusammenführen / Löschen:** Über die Symbole rechts im Abschnitt (beim Überfahren oder mit dem Fokus sichtbar).
- **Click-to-Jump:** Klick auf den Zeitstempel springt im Player an diese Stelle. Der gerade gesprochene Abschnitt wird hinterlegt und links markiert, **Mitlaufen** scrollt automatisch mit.
- **Automatisch gespeichert:** Das bearbeitete Transkript bleibt nach einem Neuladen der Seite erhalten. Die Audiodatei selbst wird nicht gespeichert und muss für den Player erneut geladen werden.
- **Auch lange Aufnahmen:** Eine echte Besprechung mit 348 Abschnitten öffnet und rendert in etwa einer Viertelsekunde.

Alle Exporte und die KI-Zusammenfassung verwenden den bearbeiteten Stand.

## Export

Über **Exportieren** über dem Transkript:

| Format | Wofür |
|---|---|
| **HTML-Seite** | Eigenständige Datei im Unisono-Stil (hell und dunkel) zum Lesen und Weitergeben. Optional mit eingebettetem Audio: Klick auf einen Zeitstempel spielt die Stelle ab. Im Browser über *Drucken → Als PDF speichern* sauber druckbar. |
| **Markdown** | Für Obsidian, Notion oder Wikis – mit Frontmatter (Titel, Datum, Quelle, Anbieter, Dauer, Sprecher, Tags). |
| **Text** | `[Projektleitung - 00:01:12]: Guten Morgen …` – zum Einfügen in E-Mail oder Word. |
| **Untertitel SRT / VTT** | Für Videos; VTT enthält die Sprechernamen. |
| **Projektdatei** (`.unisono.json`) | Speichert Transkript, Sprechernamen und Zusammenfassung. Über **Öffnen** später wieder laden und weiterbearbeiten. Die Audiodatei selbst ist nicht enthalten. |

Die KI-Zusammenfassung wird in HTML, Markdown und Projektdatei mit exportiert (abschaltbar im Menü). Beim HTML-Export mit eingebettetem Audio wird die Datei etwa ein Drittel größer als das Audio; ab 25 MB Audio ist das Einbetten deshalb standardmäßig aus.

<img src="docs/screenshots/export.png" alt="Exportierte HTML-Seite" width="100%">

## Anbieter & Modelle

| Anbieter | Modelle | Ablauf |
|---|---|---|
| Gladia (v2) | `solaria-3` (DE/EN/FR/ES/IT, feste Sprache nötig), `solaria-1` (100+ Sprachen) | Upload → `/v2/pre-recorded` → Polling |
| ElevenLabs (Scribe) | `scribe_v2`, `scribe_v1` | Synchroner Upload an `/v1/speech-to-text` |
| AssemblyAI (v2) | `universal-3-5-pro`, `universal-2` | Upload → `/v2/transcript` → Polling |
| Mistral (Voxtral) | `voxtral-mini-latest` | Synchroner Upload an `/v1/audio/transcriptions` mit Sprechertrennung und Segment-Zeitstempeln (Sprache wird automatisch erkannt) |

Sprechererkennung (Diarization) ist bei allen Anbietern aktivierbar.

Jede Engine hat eine feste Farbe (Punkt in Chips, Fortschrittslinie, Seitenleiste): Gladia Salbei, AssemblyAI Fjord, ElevenLabs Bernstein, Mistral Rosenholz. Logos erscheinen nur klein und neutral neben dem Namen unter „API-Keys“. Die Marken gehören ihren Inhabern und kennzeichnen hier nur den jeweiligen Dienst; Quellen stehen in `js/brand-logos.js`.

### Zusammenfassung

| Anbieter | Modelle (frei änderbar) | Hinweis |
|---|---|---|
| Anthropic | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` | Direktzugriff aus dem Browser über den Header `anthropic-dangerous-direct-browser-access` |
| OpenAI | `gpt-5`, `gpt-5-mini` | Chat Completions API |

Zusammengefasst wird immer der aktuelle (ggf. von dir korrigierte) Text im Ergebnisfeld.

## Handy und Tablet

Auf schmalen Bildschirmen ersetzt eine Tab-Leiste unten die Seitenleiste, Karten stehen untereinander.

<table>
  <tr>
    <td><img src="docs/screenshots/mobile.png" alt="Unisono auf dem Handy, hell"></td>
    <td><img src="docs/screenshots/mobile-dark.png" alt="Unisono auf dem Handy, dunkel"></td>
  </tr>
</table>

## Datenschutz

- Es gibt keinen Server von Unisono. Audio und Keys gehen nur an den Anbieter, den du auswählst.
- API-Keys, das zuletzt bearbeitete Transkript, Fachbegriffe und Einstellungen liegen im `localStorage` dieses Browsers; die Sicherung einer laufenden Aufnahme liegt in IndexedDB.
- Alles lässt sich unter **Einstellungen → Daten und Datenschutz** einzeln löschen oder komplett zurücksetzen.
- API-Keys im Browser sind nur für den eigenen, privaten Gebrauch gedacht – die Seite nicht mit eingetragenen Keys öffentlich hosten.

## Projektstruktur

```
index.html              Layout: Seitenleiste, Seiten (Views), Icon-Sprite, Tab-Leiste
favicon.svg             Bildmarke als App-Icon
DESIGN.md               Designregeln von Unisono (zuerst lesen)
css/tokens.css          Design-Tokens: Farben, Schrift, Abstände, Radien, Tiefe, Bewegung; Hell und Dunkel
css/app.css             Komponenten, ausschließlich aus den Tokens gebaut
fonts/                  Manrope, Inter, IBM Plex Mono (woff2, SIL Open Font License, siehe fonts/OFL.txt)
js/state.js             Zentraler State: Segmente, Sprecher, Rohdaten, Autosave
js/segment-editor.js    Segmente, Sprecherlabels und Kürzel, Redezeit, Player-Sync
js/player.js            Player-Bedienung, Wellenform und Sprecherspur
js/search.js            Suchen und Ersetzen mit Markierung im Text
js/progress.js          Fortschrittsanzeige mit Upload-Prozent und Abbrechen
js/icons.js             Linien-Icons aus dem Sprite in index.html
js/brand-logos.js       Logos der Anbieter als SVG
js/export.js            HTML, Markdown, TXT, SRT, VTT und Projektdatei aus dem bearbeiteten Stand
js/vocabulary.js        Fachbegriffsliste: Pflege, Speicherung, Import/Export, Anbieter-Grenzen
js/recorder.js          Mikrofonaufnahme (MediaRecorder), Pegel, Pause, Bildschirm-wach-halten
js/recording-backup.js  Laufende Sicherung der Aufnahme in IndexedDB, Wiederherstellung
js/summary.js           Zusammenfassung (Anthropic / OpenAI)
js/appearance.js        Hell, Dunkel oder wie System, wird vor dem ersten Zeichnen gesetzt
js/settings.js          Seite „Einstellungen“: Darstellung, Daten löschen
js/app.js               Seiten, Keys, Engine-Auswahl, Datei-Upload, Ablauf der Transkription
js/apis/common.js       Gemeinsame HTTP-Helfer: Upload mit Fortschritt, Polling, Abbrechen
js/apis/*.js            Je ein Modul pro Engine (Gladia, ElevenLabs, AssemblyAI, Mistral)
docs/screenshots/       Bilder für diese README
```

Die Skripte werden bewusst als klassische `<script defer>`-Dateien geladen und nicht als ES-Module: Browser blockieren ES-Module, wenn eine Seite per Doppelklick (`file://`) geöffnet wird. Die Module teilen sich das globale Objekt `window.Unisono`. Eine neue Engine wird als Datei unter `js/apis/` angelegt, registriert sich in `Unisono.apis` und wird in `index.html` eingebunden. Ihre Farbe kommt aus `--provider-free` bzw. einem neuen Token in `css/tokens.css` und wird in `css/app.css` unter „Provider colors“ zugeordnet.

## Design anpassen

Grundlage ist das Designsystem in [`DESIGN.md`](DESIGN.md):

- `css/tokens.css` enthält alle Werte. Hell ist Standard, Dunkel greift über die Systemeinstellung oder `data-theme="dark"` am `<html>`.
- `css/app.css` baut die Komponenten nur aus diesen Variablen: keine eigenen Farben, Schatten, Radien oder Schriftgrößen.
- Icons sind eigene Linien-Icons (24er-Raster, Strich 1,5) als `<symbol>` in `index.html`.

Die JavaScript-Dateien greifen über Element-IDs (z. B. `start-btn`, `segment-list`, `vocab-text`) auf die Seite zu. Solange diese erhalten bleiben, lässt sich das Layout frei ändern.

## Hinweise

- Schriften liegen im Ordner `fonts/`, die App lädt nichts von Google oder anderen CDNs.
- Schlägt eine Anfrage mit „Netzwerk- oder CORS-Fehler“ fehl, blockiert der Anbieter direkte Browser-Anfragen. **Prüfen** unter „API-Keys“ zeigt das vorab.
- Umbenennung: Die App hieß früher „Scribe Studio“. Keys und Einstellungen unter dem alten Namen werden nicht übernommen und beim ersten Start entfernt; alte `.scribe.json`-Projekte lassen sich nicht mehr öffnen.

## Ausblick

- **Etappe 3:** Verlauf/Archiv früherer Transkripte im Browser und Kennzahlen.
- **Etappe 4 – Meeting-Aufnahme ohne Bot (zuschaltbares Modul):** Ton eines Web-Meetings (Browser-Tab mit Ton, unter Windows auch Systemton der Desktop-App) plus eigenes Mikrofon aufnehmen und danach wie gewohnt transkribieren; das eigene Mikrofon wird als „Ich“ erkannt. Vor dem Start muss bestätigt werden, dass alle Teilnehmer informiert sind und zustimmen (§ 201 StGB). Das Modul wird erst beim Einschalten in den Einstellungen bzw. beim ersten Klick nachgeladen – wer es nicht nutzt, lädt keinen zusätzlichen Code.
- **Danach:** Protokoll-Vorlagen (Baubesprechung, Begehung, Telefonnotiz, Aktenvermerk), Aufgabenliste mit Verantwortlichen und Fristen, wiederkehrende Personen pro Projekt.
