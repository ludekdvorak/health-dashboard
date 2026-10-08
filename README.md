# Moje zdraví

Lokální osobní dashboard pro Garmin Connect a ručně zadaná měření z Feelfit.

## Spuštění

Spusť aplikaci přes místní webový server. Při otevření `index.html` přímo jako `file://` prohlížeč blokuje načítání `health-data.json` a některé funkce úložiště:

```powershell
py -m http.server 8000
```

Pak otevři <http://localhost:8000>. Server pouze zobrazí soubory aplikace a JSON; zdravotní data zůstávají v `health-data.json` a nepřenášejí se na žádnou službu.

V horní liště klikni na **Připojit datovou složku** a vyber složku, do které se má ukládat `health-data.json`. Aplikace z tohoto souboru načítá a po změně do něj automaticky zapisuje. Při prvním připojení převede dosavadní data z prohlížeče do souboru. Pro přístup z více počítačů vyber na každém zařízení stejnou složku synchronizovanou například přes OneDrive. Počkej na dokončení synchronizace a nepoužívej soubor současně na dvou zařízeních.

Přímý přístup ke složce funguje v desktopovém Chrome a Edge. Prohlížeč si pamatuje oprávnění ke složce; zdravotní záznamy jsou v `health-data.json`, v prohlížeči zůstává pouze reference na vybranou složku. Při použití OneDrive ulož datový soubor mimo Git repozitář.

## Import

- Garmin `Activities.csv` nebo JSON `summarizedActivities`: datum, typ aktivity, vzdálenost, kalorie, čas, tep, tempo, převýšení, kroky a další souhrnné metriky běhu.
- Garmin denní report `Skóre spánku 1 den` nebo JSON `sleepData`: skóre a kvalitu spánku, délku a fáze, stres, tep, Body Battery, SpO₂ a dýchání.
- Garmin týdenní `Režim spánku.csv`: průměrné skóre, kvalitu, délku a období týdne.
- Feelfit: ruční formulář podle názvů v aplikaci pro hmotnost, BMI, tělesný tuk, kosterní svaly, svalovou hmotu, protein, BMR, hmotnost bez tuku, podkožní a vnitřní tuk, vodu v těle, kostní hmotu a metabolický věk.

CSV můžeš vybrat po jednom nebo nahrát několik souborů současně. Opakovaný import stejného denního reportu nebo aktivity nevytvoří duplicitní záznam. Časové období a posuvnou časovou osu můžeš ovládat přímo na stránkách Přehled, Spánek, Aktivita i Tělesné hodnoty. Lze zvolit připravené období nebo vlastní rozsah.

Na stránce Import dat můžeš vybrat celou rozbalenou složku Garmin exportu. Import zpracuje odpovídající JSONy se souhrny aktivit, spánkem, denními kroky, kaloriemi, tepem, stresem, Body Battery, okysličením, hydratací a tréninkovými metrikami. Záznamy ze stejného dne se sloučí a aktivity se porovnají podle Garmin ID nebo data, času, vzdálenosti a délky. Opakovaný import tak nepřidává stejné hodnoty znovu. Ostatní soubory jako profil a nastavení se přeskočí; ZIP archivy se surovými FIT záznamy zatím aplikace nečte.

Stránky Spánek a Aktivita obsahují souhrnné statistiky a grafy pro zvolené období. Aktivitní grafy využijí i kadenci, délku kroku a aerobní tréninkový efekt, pokud jsou v Garmin JSON datech. Noční VST je z přehledu a grafů vynecháno. Na stránce Tělesné hodnoty jsou statistiky, trendový graf pro jednotlivé metriky a přehled posledního složení těla. Screenshot Feelfit můžeš načíst OCR; rozpoznané položky se předvyplní do formuláře a před uložením je můžeš zkontrolovat. Datum a hmotnost na screenshotu nemusí být, takže je v takovém případě doplň ručně. OCR používá Tesseract.js a při prvním použití stahuje knihovnu a rozpoznávací model; obrázek se zpracovává v prohlížeči.

Záložka Výhled & signály srovnává nedávný klidový tep a spánek s vlastním předchozím průměrem a ukazuje trend VO₂ max. Číselná projekce VO₂ je pouze přímým pokračováním trendu, ne předpovědí zdravotního stavu. Aplikace neurčuje nemoc ani její příčinu. Pro klidový tep potřebuje alespoň 4 záznamy v posledním týdnu a 10 v předchozích čtyřech týdnech; pro projekci VO₂ alespoň 5 měření v průběhu tří týdnů.

## Soukromí

Importované soubory se čtou v prohlížeči. Zdravotní záznamy zůstávají v souboru, který sis vybral; aplikace je nikam sama neposílá. Zálohuj `health-data.json` nebo složku, ve které leží.
