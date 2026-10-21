# DESIGN.md – Unisono

Designregeln für die Multi-API-Transkriptions-Website. Alle Werte stehen in `tokens.css`; diese Datei erklärt, **wie** sie eingesetzt werden. Bei jeder UI-Arbeit zuerst diese Datei lesen und `tokens.css` einbinden. Keine Hex-Werte, Schatten oder Schriftgrößen hart codieren, immer die CSS-Variablen nutzen.

## Haltung

**Markenkern: Ton und Text im Einklang.** Unisono ist ein ruhiger Arbeitsplatz für Transkripte: hochladen, lesen, korrigieren, exportieren. Aufnahme und Text bleiben Wort für Wort verbunden. Die Engines (Gladia, AssemblyAI, ElevenLabs, Mistral, weitere folgen) sind eine Option im Hintergrund; ein Vergleich mehrerer Engines ist eine Nebenfunktion, nicht der Mittelpunkt der Oberfläche. Präzise, ruhig, warm. Klarheit statt Effekt.

## Name und Schreibweise

- Produktname: **Unisono** (Fließtext, Seitentitel, Meta-Tags, E-Mails, Domain, Alt-Texte).
- Nur die **Wortmarke** schreibt **„unısono“**: Kleinbuchstaben, Manrope 400, +0,01 em, mit punktlosem i (U+0131, `ı`). Das Element trägt immer `aria-label="Unisono"`, damit Screenreader das Wort korrekt lesen.
- Das punktlose i nirgends sonst einsetzen, nicht in Überschriften, Buttons oder Texten.
- Wortmarke nie in Versalien, nie mit Binnenmajuskel, nie in Anbieterfarben.

## Sechs Regeln

1. **Leichtigkeit ist die Signatur.** Headlines in Manrope 300 (`.t-display-*`), groß und eng gespationiert. Nie fette Headlines, nie Headlines in Versalien. Fett nur in `.t-label` auf Primärbuttons und kurzen Abschnittslabels.
2. **Schwarz handelt, Farbe codiert.** Alle Aktionen nutzen `--action-primary`. Farbe steht ausschließlich für einen **Anbieter** oder einen **Status**, nie für eine Aktion.
3. **Warm statt klinisch.** Seitengrund `--surface-canvas`, Karten `--surface-raised`, Eingaben `--surface-sunken`.
4. **Tiefe flüstert.** Nur `--elev-1` bis `--elev-3` und Haarlinien (`--border-*`). Keine eigenen Schatten, keine Glows, kein Glassmorphism, keine Verläufe hinter Text.
5. **Radien nach Hierarchie.** Karten `--radius-lg`, Inputs und Sekundärbuttons `--radius-md`, Primärbutton und Chips `--radius-pill`.
6. **Bewegung wie Ausklingen.** `--ease-out` mit `--dur-fast` bis `--dur-slow`. Dauerhafte Animation nur für Grafiken (`--dur-ambient`), nie für UI-Elemente. `prefers-reduced-motion` respektieren.

## Anbieter-Farbcodierung

| Anbieter | Basis (Punkt, Grafik) | Stark (Linie, Text) | Tint (Anbieter-Fläche) |
| --- | --- | --- | --- |
| Gladia | `--provider-gladia` | `--provider-gladia-strong` | `--provider-gladia-tint` |
| AssemblyAI | `--provider-assemblyai` | `--provider-assemblyai-strong` | `--provider-assemblyai-tint` |
| ElevenLabs (weiß, im Hellmodus mit Rand) | `--provider-elevenlabs` | `--provider-elevenlabs-strong` | `--provider-elevenlabs-tint` |
| Mistral (Orange) | `--provider-mistral` | `--provider-mistral-strong` | `--provider-mistral-tint` |
| nächster Anbieter | neuer Token nötig | | |
| Alle weiteren (OpenAI, Groq, OpenRouter, Gemini, Anthropic, Together, DeepInfra, Deepgram, Soniox, xAI, Azure, DeepSeek, SiliconFlow, Scaleway, OVHcloud, Cerebras) | offizielle Markenfarbe `--pk` je Anbieter in `css/app.css` (aus den Logos) (xAI schwarz, im Dunkeln hell) | gemischt aus `--pk` | gemischt aus `--pk` |

- Die Zuordnung ist fest und überall gleich: Chips, Fortschrittslinien, Vergleichsspalten, Kostengrafiken.
- **Basis**töne nie für Text oder dünne Linien auf hellem Grund verwenden (unter 4,5:1), dafür gibt es **Stark**.
- Anbieterlogos nur klein in neutralen Chips, nie im Header oder neben der eigenen Wortmarke.

## Hell und Dunkel

Jeder Screen muss in beiden Modi funktionieren. Komponenten verwenden ausschließlich Variablen aus `tokens.css`, nie feste Hex-Werte, damit der Wechsel über `prefers-color-scheme` bzw. `data-theme` ohne Sonderfälle greift. Jeder neue Screen wird in Hell und Dunkel geprüft.

## Sprecher, Wellenform, Redezeit

Farbe bedeutet Anbieter oder Status, sonst nichts. Sprecher sind deshalb neutral:

- **Wellenform:** einfarbig. Gespielt `--wave-played`, Rest `--wave-rest`.
- **Sprecherspur:** eigene schmale Spur (ca. 14 px, Balken 8 px) direkt unter der Wellenform auf `--speaker-lane`. Redeabschnitte als Balken in `--speaker-1` bis `--speaker-4`, Hover zeigt den Namen. Die Abspielposition läuft als senkrechte Linie durch Wellenform und Spur.
- **Kürzel:** jeder Sprecher hat ein Kürzel aus 2 Buchstaben (z. B. BL, DD), das überall gleich erscheint: Spur (Tooltip), Transkript-Label, Redezeit.
- **Sprecherlabel im Transkript:** `--speaker-label-bg` als Hinterlegung, darin ein 20-px-Quadrat in der Sprecherstufe mit dem Kürzel (`--speaker-on-n`, Mono 10 px), daneben der Name in Inter 12/500.
- **Redezeit:** in der Seitenleiste als ein geteilter Balken in den Sprecherstufen, darunter Kürzel, Name, Minuten und Prozent in Mono.
- Ab 5 Sprechern wiederholen sich die Stufen; die Kürzel tragen dann die Unterscheidung.
- Anbieter-Tints nie für Sprecher verwenden.

## Komponenten

| Komponente | Regel |
| --- | --- |
| Primärbutton | Pille, `--action-primary`, Text `.t-label`, Höhe `--control-height`. Pro Ansicht genau einer. |
| Sekundärbutton | `--radius-md`, transparent, Rahmen `--border-strong`, Inter 15/500. |
| Karte | `--surface-raised`, `--radius-lg`, `--elev-1`, Innenabstand `--space-6`. |
| Input | `--surface-sunken`, `--radius-md`, Höhe `--input-height`. Fokus: `--surface-raised` + `--border-strong`. Immer mit `<label>`. |
| Engine-Chip | Pille, 36 px, farbiger Punkt des Anbieters, geschätzte Kosten in `.t-mono`. Aktiv = gefüllt mit `--action-primary`, `aria-pressed`. |
| Upload-Zone | `--surface-sunken`, Haarlinie, zeigt Dateiname, Dauer, Format. |
| Fortschritt | Pro Anbieter eine dünne Linie in dessen Farbe plus Status in Worten. |
| Transkript | `.t-body-l`, max. `--measure`. Zeitstempel links in `.t-mono` + `--text-tertiary`. Sprecherlabel neutral (siehe „Sprecher, Wellenform, Redezeit“). |
| Markierungen | Gespieltes Wort `--mark-playing-bg` + 2-px-Unterlinie. Unsicher: gepunktete Unterstreichung `--mark-uncertain`. Abweichung: `--mark-diff-bg` + Unterlinie `--mark-diff-line`. |
| Vergleich | 2–3 Spalten nebeneinander, Kopf mit Anbieter, Dauer, Kosten, Konfidenz (Mono). |
| Tabellen | Zeilen durch `--border-subtle` getrennt, Zahlen in `.t-mono`, rechtsbündig. |
| Status | Kleiner Punkt in Statusfarbe, Text bleibt neutral. |
| Navigation | Seitenleiste `--sidebar-width`, aktiver Punkt als weiße Karte mit `--elev-1`, `aria-current="page"`. Mobil: Tab-Leiste unten, Ziele mind. `--touch-min`. |

## Logo

Lockup: Bildmarke links, Wortmarke „unısono“ rechts, Abstand 0,4 × Markenhöhe. Bildmarke: drei linksbündige Linien in den Längen 1, ½, ⅓ auf 48er-Raster (Strich 3,5, Abstand 8). Nur Tinte oder Creme, nie Anbieterfarben. Ab 32 px und kleiner dickerer Strich. Nie zentriert, rechtsbündig oder als Equalizer animiert.

## Texte

Deutsch, Satzanfang groß, kurze Sätze, konkrete Verben, keine Superlative, keine Ausrufezeichen. Buttons sagen, was passiert („2 Engines starten“, „Exportieren“). Fehlermeldungen nennen Ursache und nächsten Schritt.

## Barrierefreiheit

- Text mind. 4,5:1 (alle Text-Tokens erfüllen das auf ihren Flächen).
- Echte `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` an Icon-Buttons.
- Sichtbarer Fokus über `:focus-visible` (in `tokens.css` gesetzt).
- Farben, die unterschieden werden müssen, zusätzlich durch Beschriftung oder Form unterscheiden.

## Verboten

Verläufe hinter Text, Neon, Glows, Glassmorphism, farbige Buttons, fette oder versale Headlines, Equalizer-Deko, Kopfhörer- und Mikrofon-Klischees als Dekoration, Logos oder Schriften anderer Marken.
