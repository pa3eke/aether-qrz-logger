# Aether QRZ Logger

[English](README.md) · Nederlands

Eerste publieke versie. Getest met FlexRadio en AetherSDR op macOS; andere configuraties zijn nog niet uitgebreid getest.

Een kleine interface voor FlexRadio met AetherSDR. Je voert call en rapporten in,
de interface volgt frequentie en mode via TCI en verstuurt de verbinding met de
QRZ Logbook API. Geen extra Python-pakketten nodig; Python 3.10+ en een moderne browser.

## Starten op je Mac

1. Start AetherSDR, verbind je FlexRadio en zet de TCI-server aan. Standaardpoort: **50001**.
2. Dubbelklik op **Start logboek.command**. Houd het Terminal-venster open zolang je logt.
3. Open zo nodig <http://127.0.0.1:8765> in je browser.
4. Vul onder Instellingen je eigen call en **QRZ Logbook API-sleutel** in.
   Je vindt die bij de instellingen van het juiste logboek op QRZ. Dit is een andere
   voorziening dan QRZ XML/callbook lookup. QRZ vereist een abonnement voor API INSERT.
5. Laat het TCI-adres op `ws://127.0.0.1:50001` staan als AetherSDR op dezelfde Mac draait.
6. Vul eventueel je standaardvermogen in watt in en sla de instellingen op.

De sleutel blijft standaard alleen in het geheugen van het lokale programma.
Met “Bewaar de sleutel lokaal” wordt hij in `data/settings.json` bewaard,
leesbaar voor jouw macOS-account (bestandsrechten 0600). Het bestand is niet versleuteld.
De sleutel wordt niet teruggestuurd naar de browser of in toegangslogs geschreven.

## Loggen

### Naam en andere stationsgegevens

Vul onder **Instellingen → Stationsgegevens uit QRZ** je QRZ-gebruikersnaam en
wachtwoord in. Hiervoor wordt de officiële QRZ XML-dienst gebruikt, met HTTPS POST;
de Logbook API-sleutel geeft geen toegang tot callsign-gegevens. Volledige gegevens
vereisen XML-toegang in je QRZ-abonnement. Je wachtwoord blijft standaard in het geheugen;
alleen als je de aparte bewaaroptie aanvinkt wordt het lokaal opgeslagen in hetzelfde
bestand met rechten 0600. Dit bestand is niet versleuteld.

Na het invoeren van een call worden de beschikbare gegevens automatisch opgezocht.
De naam, plaats, land, locator en QSL-informatie verschijnen onder het callveld.
**Alle QRZ-stationsgegevens** toont ook de overige teruggegeven velden. Bij een andere
call verdwijnen de vorige gegevens direct. Een lookup die later antwoordt kan de gegevens
van een nieuw ingevoerde call niet overschrijven. De knop Save in QRZ wordt pas actief als naam, land en QTH voor de ingevoerde
call beschikbaar zijn. Bij ontbrekende XML-toegang of een niet-gevonden call blijft
opslaan geblokkeerd zodat je eerst de stationsgegevens kunt controleren.

Naam (`NAME`), plaats (`QTH`), adres (`ADDRESS`), locator (`GRIDSQUARE`), land,
DXCC, CQ-/ITU-zone, staat, county, e-mail, website, IOTA, geografische coördinaten
en QSL-manager worden waar beschikbaar als ADIF-velden naar QRZ meegestuurd.
Beschikbare kolommen en wat QRZ toont zijn afhankelijk van QRZ Logbook.
Alle overige XML-stationsvelden worden in het lokale log en in het ADIF-veld
`APP_AETHERQRZ_PROFILE` bewaard. In Recente verbindingen kun je Stationsgegevens
uitklappen om de bewaarde gegevens te zien.

De standaard ADIF-tekstvelden worden naar gewone ASCII-letters omgezet (André → Andre).
De oorspronkelijke spelling blijft bewaard in de lokale stationsgegevens en het
profielveld in het ADIF-bestand. De QRZ-locatie is het opgegeven stationsadres;
een station kan tijdens het QSO vanaf een andere locatie werken.

Referentie: [QRZ XML-specificatie](https://www.qrz.com/docs/xml/current_spec.html).

- De interface volgt standaard de **TX-slice**. Kies desgewenst zelf een slice.
- Bij split wordt voor de TX-slice de gemelde TX-frequentie gelogd; de RX-frequentie
  wordt afzonderlijk als `FREQ_RX` opgeslagen als die afwijkt.
- De starttijd wordt in UTC vastgelegd zodra je de call begint in te typen.
  “Nieuwe verbinding” wist call/opmerking en begint een nieuwe starttijd.
- USB/LSB worden SSB, CWR wordt CW, NFM wordt FM. Bij DIGU/DIGL kies je de
  werkelijke mode, zoals FT8 of FT4. TCI kan die niet uit DIGU/DIGL afleiden.
- De RF-instelling uit TCI is een percentage, **geen gemeten uitgangsvermogen**.
  Vul watt handmatig in, eventueel inclusief je versterker. Dit wordt `TX_PWR`.
- Controleer eerst **naam, land en QTH**, daarna de QSO-gegevens, en klik
  **Save in QRZ**. Enter in het callveld zoekt alleen de gegevens op en slaat niet op.
  Na QRZ-bevestiging blijft de interface klaarstaan voor de volgende call.
- Bij een verbroken TCI-verbinding worden radiogegevens gewist en wordt loggen geblokkeerd.
  Er wordt na drie seconden opnieuw verbinding gemaakt.
- Deze interface stuurt geen bedienings- of zendcommando's naar de radio.

### S-rapport uit de radio

De optie **S-waarde in Verzonden RST uit de S-meter** gebruikt de TCI-signaalmeting
van de geselecteerde slice. De hoogste ontvangstmeting van de laatste vijf seconden
wordt omgerekend naar S1–S9. Boven S9 blijft het RST-cijfer 9; de extra dB's
verschijnen naast de meter en blijven als lokaal ADIF-profielveld bewaard.
De schaal gebruikt 6 dB per S-punt, met S9 = −73 dBm onder 30 MHz en −93 dBm daarboven.

Dit vult de **S in het verzonden rapport** in: de sterkte van het tegenstation
zoals jij die ontvangt. Het **ontvangen rapport** komt van je tegenstation en
blijft handmatig. R (leesbaarheid) en T (CW-toonkwaliteit) blijven jouw beoordeling;
de bestaande R-waarde blijft staan en bij CW wordt een ontbrekende T op 9 gezet.
Controleer die waarden zelf. Digitale rapporten zoals FT8 worden niet uit de
S-meter afgeleid. Zelf Verzonden RST wijzigen schakelt automatisch S uit.

Tijdens jouw uitzending blijft de laatste ontvangstpiek maximaal één minuut staan.
Bij afstemmen, modewisseling, stoppen of verlies van de verbinding vervalt de meting.
Zonder recente meting kun je automatisch S uitschakelen en handmatig loggen.
De meter kan ook ruis of een ander signaal in de ontvangstbandbreedte meten:
controleer het voorgestelde rapport vóór het loggen.

Elke aangeboden verbinding wordt eerst lokaal in `data/log.sqlite3` bewaard met
uploadstatus. Download lokaal ADIF bevat alle verbindingen, inclusief geweigerde
en onzekere uploads; het veld `APP_AETHERQRZ_STATUS` geeft `ok`, `failed` of `uncertain` aan.
Importeer dit bestand niet blind opnieuw naar QRZ: er kunnen al gelogde verbindingen in staan.
Een ontbrekend antwoord betekent niet noodzakelijk dat QRZ de verbinding niet heeft opgeslagen.
De interface probeert daarom niet automatisch opnieuw en overschrijft geen dubbele QSOs.

Alleen succesvolle QRZ-antwoorden verschijnen als “In QRZ”. Bij een fout blijven
de invoervelden staan; controleer de status en kies na correctie Nieuwe verbinding.
De ondersteunde frequentiebanden zijn 160 m t/m 70 cm (inclusief 60 m en 4 m);
dit is logvalidatie, geen controle van plaatselijke zendbevoegdheid.

## Handmatig starten en testen

```sh
python3 server.py
python3 -m unittest -v test_server.py
node test_tci.js
node test_workflow.js
```

Met `python3 server.py --no-browser` start je zonder automatisch een browser te openen.
De server luistert alleen op `127.0.0.1:8765`. Stoppen: Ctrl+C in Terminal.
Als het logboek al draait, opent de starter de bestaande interface. Er wordt dan
geen tweede server gestart. Het nieuwe Terminal-venster mag je daarna sluiten;
het oorspronkelijke venster blijft het logboek uitvoeren.

Referenties: [QRZ API](https://www.qrz.com/docs/logbook/QRZLogbookAPI.html),
[AetherSDR TCI](https://github.com/aethersdr/AetherSDR/blob/main/src/core/TciProtocol.cpp).

De stationscontrole geldt voor nieuwe verbindingen. Zodra je de call wijzigt,
verdwijnt de vorige controle en wordt Save geblokkeerd tot de nieuwe gegevens er zijn.

## QRZ-pagina in een apart venster

Vul een call in en klik **QRZ-pagina openen**. De openbare QRZ-pagina van die call
opent in een apart browservenster. Dezelfde knop verandert in **QRZ sluiten · CALL**;
nogmaals klikken probeert het venster te sluiten. Sommige browsers staan sluiten niet toe; sluit het venster dan zelf. Sluit je het venster zelf, dan keert de knop
automatisch terug naar Openen. Het geopende venster blijft bij de oorspronkelijke
call totdat je het sluit; daarna kun je een andere call openen.
Hiervoor is geen XML-login nodig. Als de browser pop-ups blokkeert, sta ze toe voor
de lokale interface. Of de browser een los venster of een tab opent, hangt van de browser af.

### Kaart en afstand

De tab **Kaart · afstand** toont de verbinding tussen je eigen QTH en het huidige tegenstation of een van de 30 recente verbindingen. De locaties komen uit QRZ-coördinaten, met de locator als alternatief. Je kunt je eigen locator op de kaart invullen en met **Kaart bijwerken** bewaren in deze browser. De afstand is de kortste afstand over het aardoppervlak, afgerond op kilometers; locators gebruiken het midden van hun vak. De lijn volgt deze route. De kaartachtergrond gebruikt OpenStreetMap en vereist internet. Ontbrekende locaties worden gemeld en niet geschat op basis van alleen het land.

Roepnamen bij **Recente verbindingen** zijn klikbaar en openen de openbare QRZ-pagina in een nieuw tabblad.

## Licentie

MIT, zie [LICENSE](LICENSE). Dit is een onafhankelijk project, zonder officiële verbinding met FlexRadio, AetherSDR of QRZ. De gebruikersinterface is Nederlandstalig.
