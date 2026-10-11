"""Local-only dashboard server and on-demand Garmin Connect sync."""

from __future__ import annotations

import getpass
import json
import os
import threading
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "health-data.json"
TOKEN_DIR = ROOT / ".garminconnect"
SYNC_LOCK = threading.Lock()


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = ROOT / ".env"
    if not env_file.exists():
        return values
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def number(*values):
    for value in values:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return None


def first(mapping, *keys):
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        value = mapping.get(key)
        if value is not None:
            return value
    return None


def day_record(day: str, stats, sleep, heart, battery) -> dict:
    sleep_dto = first(sleep, "dailySleepDTO") or {}
    score_dto = first(sleep_dto, "sleepScoreDTO") or {}
    overall = first(score_dto, "overallScore")
    if isinstance(overall, dict):
        overall = first(overall, "value")

    charged = drained = None
    battery_entries = battery if isinstance(battery, list) else [battery] if isinstance(battery, dict) else []
    battery_levels = []
    for entry in battery_entries:
        charged_value = number(first(entry, "charged", "chargedValue"))
        drained_value = number(first(entry, "drained", "drainedValue"))
        if charged_value is not None:
            charged = (charged or 0) + charged_value
        if drained_value is not None:
            drained = (drained or 0) + drained_value
        values = first(entry, "bodyBatteryValuesArray") or []
        for point in values:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                level = number(point[1])
                if level is not None:
                    battery_levels.append({"time": point[0], "value": level})
    if charged is None:
        charged = number(first(stats, "bodyBatteryChargedValue"))
    if drained is None:
        drained = number(first(stats, "bodyBatteryDrainedValue"))
    if charged == 0:
        charged = None
    if drained == 0:
        drained = None

    fields = {
        "type": "daily", "date": day, "source": "Garmin Connect · místní synchronizace",
        "sleepScore": number(overall, first(sleep_dto, "sleepScore")),
        "sleepDuration": (number(first(sleep_dto, "sleepTimeSeconds")) / 60
                          if number(first(sleep_dto, "sleepTimeSeconds")) is not None
                          else number(first(sleep_dto, "sleepDuration"))),
        "deepSleep": number(first(sleep_dto, "deepSleepSeconds")) / 60 if number(first(sleep_dto, "deepSleepSeconds")) is not None else None,
        "lightSleep": number(first(sleep_dto, "lightSleepSeconds")) / 60 if number(first(sleep_dto, "lightSleepSeconds")) is not None else None,
        "remSleep": number(first(sleep_dto, "remSleepSeconds")) / 60 if number(first(sleep_dto, "remSleepSeconds")) is not None else None,
        "awakeDuration": number(first(sleep_dto, "awakeSleepSeconds")) / 60 if number(first(sleep_dto, "awakeSleepSeconds")) is not None else None,
        "sleepUnitsVersion": 2,
        "restingHr": number(first(heart, "restingHeartRate"), first(stats, "restingHeartRate")),
        "steps": number(first(stats, "totalSteps", "steps")),
        "totalCalories": number(first(stats, "totalKilocalories", "totalCalories")),
        "activeCalories": number(first(stats, "activeKilocalories", "activeCalories")),
        "stress": number(first(stats, "averageStressLevel", "avgStress")),
        "bodyBatteryCharged": charged, "bodyBatteryDrained": drained,
        "bodyBatteryChange": (charged or 0) - (drained or 0) if charged is not None or drained is not None else None,
        "bodyBatteryLevels": battery_levels or None,
        "spo2Avg": number(first(sleep_dto, "averageSpo2Value")),
        "breathingAvg": number(first(sleep_dto, "averageRespirationValue")),
        "hasSleepData": bool(sleep_dto),
    }
    # Keep only fields actually returned by Garmin; null overwrites would erase richer exports.
    return {key: value for key, value in fields.items() if value is not None}


def activity_record(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None
    activity_id = first(item, "activityId", "activity_id")
    started = first(item, "startTimeLocal", "startTimeGMT", "startTime")
    if not started:
        return None
    try:
        stamp = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
    except ValueError:
        return None
    distance = number(first(item, "distance"))
    duration = number(first(item, "duration"))
    activity_type = first(item, "activityType", "activityTypeName") or "Aktivita"
    if isinstance(activity_type, dict):
        activity_type = first(activity_type, "typeKey", "typeName", "displayName") or "Aktivita"
    return {
        "id": f"garmin:{activity_id}" if activity_id is not None else f"{stamp.isoformat()}:{distance}",
        "activityId": activity_id, "date": stamp.date().isoformat(), "time": stamp.strftime("%H:%M:%S"),
        "type": activity_type,
        "name": first(item, "activityName", "name") or "Aktivita",
        "source": "Garmin Connect · místní synchronizace",
        "distance": distance / 1000 if distance is not None else None,
        "duration": duration, "calories": number(first(item, "calories")),
        "avgHr": number(first(item, "averageHR", "avgHR")), "maxHr": number(first(item, "maxHR")),
        "steps": number(first(item, "steps")),
    }


def connect_and_sync(days: int) -> dict:
    settings = read_env()
    email = settings.get("GARMIN_EMAIL") or os.environ.get("GARMIN_EMAIL")
    password = settings.get("GARMIN_PASSWORD") or os.environ.get("GARMIN_PASSWORD")
    if not email:
        raise RuntimeError("Doplň GARMIN_EMAIL v souboru .env.")
    if not password:
        password = getpass.getpass("Heslo Garmin Connect (nezobrazí se): ")
    try:
        from garminconnect import Garmin
    except ImportError as exc:
        raise RuntimeError("Chybí knihovna garminconnect. Spusť install.bat a server spusť znovu.") from exc

    client = Garmin(email, password, prompt_mfa=lambda: input("Garmin ověřovací kód (MFA): "))
    client.login(str(TOKEN_DIR))
    today = date.today()
    start = today - timedelta(days=days - 1)
    records: dict[str, dict] = {}
    for offset in range(days):
        day = start + timedelta(days=offset)
        day_text = day.isoformat()
        stats = client.get_stats(day_text)
        sleep = client.get_sleep_data(day_text)
        heart = client.get_heart_rates(day_text)
        battery = client.get_body_battery(day_text)
        record = day_record(day_text, stats, sleep, heart, battery)
        if len(record) > 3:
            records[day_text] = record

    activities = client.get_activities_by_date(start.isoformat(), today.isoformat())
    existing = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {
        "schemaVersion": 1, "sleepRecords": [], "activityRecords": [], "weightRecords": [], "importRecords": []
    }
    by_day = {row.get("date"): row for row in existing.get("sleepRecords", []) if row.get("date")}
    for day_text, incoming in records.items():
        prior = by_day.get(day_text, {})
        # Garmin's latest values refresh matching fields and preserve existing metrics not covered by the API.
        by_day[day_text] = {**prior, **incoming}
    existing["sleepRecords"] = sorted(by_day.values(), key=lambda row: row.get("date", ""))

    by_activity = {str(row.get("id") or row.get("activityId")): row for row in existing.get("activityRecords", [])}
    for item in activities or []:
        row = activity_record(item)
        if row:
            key = str(row.get("id") or row.get("activityId"))
            by_activity[key] = {**by_activity.get(key, {}), **row}
    existing["activityRecords"] = sorted(by_activity.values(), key=lambda row: (row.get("date", ""), row.get("time", "")))
    existing["updatedAt"] = datetime.now().astimezone().isoformat()
    existing.setdefault("importRecords", []).insert(0, {
        "fileName": "Garmin Connect · synchronizace", "count": len(records) + len(activities or []),
        "dateLabel": today.strftime("%Y-%m-%d"),
    })
    existing["importRecords"] = existing["importRecords"][:100]
    DATA_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"data": existing, "days": len(records), "activities": len(activities or [])}


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        # Avoid putting health data or account identifiers in the server log.
        super().log_message(fmt, *args)

    def send_head(self):
        parts = [unquote(part) for part in urlparse(self.path).path.split("/") if part]
        if any(part.startswith(".") for part in parts):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Výpis složek není povolen.")
        return None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/weather":
            url = (
                "https://api.open-meteo.com/v1/forecast?latitude=50.0755&longitude=14.4378"
                "&timezone=Europe%2FPrague&forecast_days=7"
                "&current=temperature_2m%2Capparent_temperature%2Crelative_humidity_2m%2Cwind_speed_10m%2Cweather_code"
                "&hourly=temperature_2m%2Cprecipitation_probability%2Cprecipitation%2Cweather_code%2Cwind_speed_10m"
                "&daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min%2Cprecipitation_probability_max"
            )
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "MojeZdraviDashboard/1.0"})
                with urllib.request.urlopen(request, timeout=8) as response:
                    body = response.read(200_000)
                status = 200
            except Exception:
                body = json.dumps({"error": "Počasí se teď nepodařilo načíst."}, ensure_ascii=False).encode("utf-8")
                status = 502
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if path != "/api/news":
            return super().do_GET()
        try:
            items = []
            feeds = [
                ("https://www.root.cz/rss/clanky", "Root.cz", "it"),
                ("https://www.root.cz/rss/zpravicky", "Root.cz", "it"),
                ("https://zing.cz/rss/novinky", "Zing.cz", "gaming"),
            ]
            for feed_url, source, category in feeds:
                try:
                    request = urllib.request.Request(
                        feed_url,
                        headers={"User-Agent": "MojeZdraviDashboard/1.0 (personal RSS reader)"},
                    )
                    with urllib.request.urlopen(request, timeout=8) as response:
                        root = ET.fromstring(response.read(1_500_000))
                    entries = root.findall("./channel/item")
                    for entry in entries[:10]:
                        title = (entry.findtext("title") or "").strip()
                        link = (entry.findtext("link") or "").strip()
                        published = (entry.findtext("pubDate") or entry.findtext("date") or "").strip()
                        if title and link.startswith("https://"):
                            items.append({"title": title, "link": link, "published": published, "source": source, "category": category})
                    if not entries:
                        ns = "{http://www.w3.org/2005/Atom}"
                        for entry in root.findall(f".//{ns}entry")[:10]:
                            title = (entry.findtext(f"{ns}title") or "").strip()
                            link_element = entry.find(f"{ns}link")
                            link = (link_element.get("href", "") if link_element is not None else "").strip()
                            published = (entry.findtext(f"{ns}published") or entry.findtext(f"{ns}updated") or "").strip()
                            if title and link.startswith("https://"):
                                items.append({"title": title, "link": link, "published": published, "source": source, "category": category})
                except Exception:
                    continue
            if not items:
                raise RuntimeError("RSS kanály nejsou dostupné.")
            body = json.dumps({"items": items}, ensure_ascii=False).encode("utf-8")
            status = 200
        except Exception:
            body = json.dumps({"error": "Zprávy se teď nepodařilo načíst."}, ensure_ascii=False).encode("utf-8")
            status = 502
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlparse(self.path).path != "/api/garmin/sync":
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).hostname not in {"localhost", "127.0.0.1", "[::1]"}:
            self.send_error(403)
            return
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            days = max(1, min(90, int(payload.get("days", 30))))
            if not SYNC_LOCK.acquire(blocking=False):
                raise RuntimeError("Synchronizace už běží.")
            try:
                result = connect_and_sync(days)
            finally:
                SYNC_LOCK.release()
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
        except Exception as exc:
            body = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    os.chdir(ROOT)
    port = int(os.environ.get("DASHBOARD_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), DashboardHandler)
    print(f"Dashboard: http://127.0.0.1:{port}")
    print("Garmin synchronizace: pouze místně, po kliknutí na tlačítko v aplikaci.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer ukončen.")
    finally:
        server.server_close()
