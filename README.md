# Elster Form Helper API

Diese API ist eine ergänzende Wissensschicht zu den offiziellen Ausfüllhilfen der Elster Formulare für Umsatzsteuer (USt), Körperschaftsteuer (KSt) und Gewerbesteuer (GewSt). Sie liefert strukturierte Metadaten pro Feld, damit Schulungen, interaktive Lernumgebungen und LLM gestützte Chats präzisere und kontextreiche Hilfestellungen geben können.

## Ziel
Erweiterung der Ausfüllhilfen um maschinenlesbare, kontextualisierte Informationen zu jedem Formularfeld. Dadurch werden Verständnis, Validierung, Fehlerprävention und didaktische Aufbereitung verbessert.

## Anwendungsfälle
* LLM Chat Assistent zur Beantwortung von Fragen zu einzelnen Feldern
* Schulungsmodus der Beispielbeschreibungen und Stolpersteine anzeigt
* Automatisierte Prüfung von Eingaben gegen einfache Validierungsregeln
* Generierung erklärender Tooltips in Weboberflächen oder internen Portalen
* Ableitung strukturierter Prompts für Retrieval Augmented Generation Workflows

## Didaktische Ausrichtung
JSON Strukturen enthalten Felder und Auswahlwerte. Optionale didaktische Zusatzschlüssel können ergänzt werden (z B lernhinweise beispiele typischeFehler) sofern vorhanden.

## Funktionsumfang
* Auslieferung vorbereiteter JSON Dateien je Formular, Jahr und Steuerart
* Authentifizierung per statischem Bearer Token
* Betrieb per Node.js direkt oder via Docker Compose
* Lesbare verschachtelte Struktur (context_label -> sections -> rows)

## Verzeichnisstruktur der Formulardaten
Die Dateien liegen unter
```
src/data/forms/<typ>/<jahr>/<formular>.json
```
Konventionen
* typ ist kleingeschrieben: gewst kst ust
* Dateinamen sind kebab-case ohne Leerzeichen
* Keine Erweiterung in der URL übergeben (Server hängt .json an)

Beispiele (real vorhanden)
```
src/data/forms/kst/2022/00-hauptvordruck-kst-1.json
src/data/forms/gewst/2022/00-gewerbesteuererkl-rung.json
src/data/forms/ust/2022/00-hauptvordruck-ust-2-a.json
```

## Endpunkt
GET /v1/forms/:typ/:jahr/:formular

Parameter:
* typ: gewst | kst | ust (klein geschrieben wie Verzeichnisnamen)
* jahr: Steuerjahr, z B 2022
* formular: Dateiname ohne .json Erweiterung

Antwort (bei Erfolg): HTTP 200 mit JSON Inhalt der Datei
Fehlerfälle:
* 401 Unauthorized wenn Token fehlt oder falsch
* 404 Form not found wenn Datei nicht existiert
* 500 Internal server error bei anderen Fehlern

## Authentifizierung
Erforderlich ist ein Header:
Authorization: Bearer <AUTH_TOKEN>

Der Wert wird über die Umgebungsvariable AUTH_TOKEN gesetzt.

## Umgebungsvariablen
- AUTH_TOKEN (erforderlich) Geheimnis für einfachen Zugriffsschutz
- PORT (optional) Standard 3000

Beispiel .env Datei:
```
AUTH_TOKEN=mein-geheimes-token
PORT=3000
```

## Lokaler Start ohne Docker
Im Verzeichnis API-Server

1. Abhängigkeiten installieren
```
npm install
```
2. Server starten
```
node src/server.js
```
3. Zugriff prüfen (Beispiel real vorhandene Datei)
```
curl -H "Authorization: Bearer mein-geheimes-token" \
  http://localhost:3000/v1/forms/kst/2022/00-hauptvordruck-kst-1
```

## Start mit Docker Compose
1. .env Datei anlegen (siehe oben)
2. Container bauen und starten
```
docker compose up -d --build
```
3. Optionales Port Mapping Host 8080 auf Container 3000 (falls benötigt kann eine zusätzliche Datei compose.override.yaml angelegt werden siehe Anlage Beispiel unten)
4. Test
```
curl -H "Authorization: Bearer mein-geheimes-token" \
  http://localhost:8080/v1/forms/gewst/2022/00-gewerbesteuererkl-rung
```

## Formularbestand und Aktualisierung
Die JSON Dateien werden über die Skripte `kst_elster_scraper.py` und `formular_daten_generator.py` erzeugt. Manuelle Änderungen möglichst vermeiden damit ein erneuter Import konsistent bleibt.

Kurzer Ablauf
1. Scraper ausführen
2. Generator ausführen
3. Dateien nach `src/data/forms/<typ>/<jahr>/` übernehmen
4. Stichprobe prüfen und committen

## (Optional) Manuelle Ergänzungen
Zusätzliche Schlüssel nur hinzufügen wenn nicht durch erneuten Import verloren.

## Beispiel minimaler Block
Struktur orientiert sich am bestehenden Schema (siehe unten) ergänzende Schlüssel möglich
```
{
  "context_label": "1 - Allgemeine Angaben",
  "sections": [
    {
      "section_label": null,
      "rows": [
        {
          "row": "3",
          "label": "Unternehmen/Firma",
          "type": "text",
          "values": []
        }
      ],
      "sections": []
    }
  ]
}
```
4. Abruf sofort ohne Neustart möglich solange Datei vorhanden ist
5. Für Schulungsszenarien zusätzliche Schlüssel wie lernhinweise beispiele typischeFehler ergänzen

### Beispiel compose.override.yaml (optional)
```
services:
  elster-form-helper-api:
    ports:
      - "8080:3000"
```

## Struktur der JSON Dateien
Jede Formular Datei ist ein Array von Kontextblöcken
Element Struktur
* context_label beschreibt den Abschnitt oder Block
* sections ist ein Array verschachtelter Section Objekte

Section Objekt
* section_label optional Überschrift
* rows Array einzelner Zeilen
* sections optionale Unterabschnitte (rekursiv)

Row Objekt
* row Zeilennummer oder null bei Hinweisen
* label Feldbezeichnung im Formular
* type text select radio checkbox date note repeater (ggf leer bei Freitextfeldern)
* values Liste möglicher Werte bei Auswahlfeldern sonst leer

Repeater
* type repeater kennzeichnet Sammler für wiederholbare Unterstrukturen

Erweiterungen
* Eigene Zusatzschlüssel pro row oder section möglich (z B lernhinweise beispiele typischeFehler bewertungen tags)

## Fehlerbehandlung
- Nicht gefundene Dateien: 404 mit { "error": "Form not found." }
- Falsches oder fehlendes Token: 401 mit { "error": "Unauthorized" }
- Unerwartete Fehler: 500 mit { "error": "Internal server error." }

## Lizenz
MIT Lizenz

Copyright (c) 2025 Dennis Menken

Erlaubnis wird hiermit unentgeltlich erteilt jeder Person eine Kopie dieser Software und der zugehörigen Dokumentationen (die "Software") zu erhalten und uneingeschränkt zu nutzen einschließlich und ohne Ausnahme des Rechts die Software zu verwenden zu kopieren zu verändern zusammenzuführen zu veröffentlichen zu verbreiten zu unterlizenzieren und/oder zu verkaufen und Personen die Software zur Verfügung zu stellen unter den folgenden Bedingungen

Der obige Urheberrechtsvermerk und dieser Erlaubnisvermerk sind in allen Kopien oder wesentlichen Teilen der Software beizulegen

Die Software wird ohne Gewährleistung bereitgestellt ohne ausdrückliche oder implizite Garantie einschließlich aber nicht beschränkt auf die Garantien der Marktreife der Eignung für einen bestimmten Zweck und der Nichtverletzung. In keinem Fall sind die Autoren oder Copyright-Inhaber für Ansprüche Schäden oder sonstige Verpflichtungen haftbar zu machen sei es aus einer Vertragshandlung einem Delikt oder anderweitig die aus oder im Zusammenhang mit der Software oder der Verwendung oder anderen Handlungen in der Software entstehen

## Hinweise für Integration mit LLMs
* Dateien sind statisch (Caching möglich)
* Hierarchie (context_label/sections/rows) bietet natürliche Chunks
* Schlüssel für Referenzen: Kombination aus Pfad + row + label
* Auswahlwerte liefern kontrolliertes Vokabular

## Hinweis
Kein Schreibendpunkt vorhanden. Fokus ausschließlich auf das Ausliefern vorhandener JSON Formulare.
