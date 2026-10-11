# Moje zdraví

Lokální osobní dashboard pro Garmin Connect a ručně zadaná měření z Feelfit.

## Místní spuštění

1. Nainstaluj Python 3.12 nebo novější.
2. Pokud už máš připravený `.env`, není potřeba ho při každém spuštění upravovat. Soubor zůstává pouze lokálně a Git ho ignoruje.
3. V Průzkumníku můžeš dvojkliknout na `install-and-run.bat`. V PowerShellu ve složce projektu spusť:

   ```powershell
   .\install-and-run.bat
   ```

   To je doporučený jediný příkaz: BAT zkontroluje/nainstaluje potřebné Python balíčky a sám spustí `server.py`. Nespouštěj oba způsoby za sebou.
4. Nech otevřené okno konzole a otevři <http://127.0.0.1:8765>. Server poběží, dokud okno nezavřeš nebo v něm nestiskneš `Ctrl+C`.

Pokud už jsou závislosti nainstalované, můžeš místo BATu spustit přímo `py server.py`. Je to alternativní způsob spuštění téhož serveru, ne druhý krok.

Server poslouží stránku a soubory aplikace a při synchronizaci uloží sloučená data do `health-data.json`. Když Garmin vyžádá MFA, zadej jednorázový kód do okna Python serveru. Heslo se v UI nezobrazuje. Pro první přihlášení lze ponechat `GARMIN_PASSWORD` prázdné; server si ho vyžádá skrytě v konzoli.

## Synchronizace Garmin Connect

Na stránce **Import dat** klikni na **Synchronizovat Garmin**. Aplikace načte posledních 30 dní denních statistik, spánku, tepových údajů, Body Battery a aktivit; data sloučí s dosavadním JSON souborem a v prohlížeči překreslí dashboard. Synchronizace se spouští ručně a běží pouze při zapnutém místním serveru.

Připojení používá komunitní, neoficiální Python klient pro Garmin Connect, protože účet nemá přístup ke Garmin Health API. Ten klient se přihlašuje k webovým službám Garminu; Garmin může přihlašovací postup nebo rozhraní změnit a integrace pak může vyžadovat opravu. Oficiální Health API vyžaduje schválení v Garmin Connect Developer Program. Synchronizace proto není garantovanou ani Garminem podporovanou funkcí.

`.env` obsahuje místní přihlašovací údaje a `.garminconnect/` uložené přihlašovací tokeny. Obě cesty jsou ignorované Gitem. Nesdílej je a nikdy je nevkládej do HTML nebo JavaScriptu. Server poslouchá pouze na `127.0.0.1`; nic se nehostuje veřejně. Údaje se posílají přes HTTPS službě Garmin při přihlášení. Zdravotní data se ukládají místně do `health-data.json` a prohlížeče.

## Import exportu

Dashboard dál podporuje ruční Garmin CSV/JSON exporty a Feelfit formulář/OCR. Importované Garmin reporty zahrnují spánek, fáze spánku, stres, tep, denní nabití/vybití Body Battery, SpO₂, dýchání a další metriky. Synchronizace navíc načte časový průběh úrovně Body Battery, pokud jej Garmin Connect pro daný den poskytne. Opakovaný import sloučí stejné dny a aktivity. CSV můžeš vybrat po jednom nebo nahrát celou rozbalenou složku Garmin exportu; ZIP archivy se surovými FIT záznamy se přeskočí.

Stránky Přehled, Spánek a Aktivita obsahují souhrnné statistiky a grafy pro zvolené období. Časový rozsah lze nastavit v horní části dashboardu. Tělesné hodnoty můžeš zadat ručně nebo předvyplnit z obrázku Feelfit přes OCR; rozpoznané položky lze před uložením zkontrolovat.

Volitelné: `py -m http.server 8000` spustí pouze statickou stránku na <http://127.0.0.1:8000>, bez Garmin synchronizace. Pro běžné používání doporučuji `install-and-run.bat` a adresu na portu `8765`.

## Zdravotní interpretace

Grafy a hypotézy popisují trendy ve spotřebitelských datech, neurčují jejich příčinu ani zdravotní stav. Nejde o klinickou diagnózu.
