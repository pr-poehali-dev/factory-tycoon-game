"""Таблица лидеров: получить топ-50 и обновить данные игрока"""
import json
import os
import psycopg2


CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()

    try:
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            player_id = str(body.get("player_id", ""))[:20]
            balance = int(body.get("balance", 0))
            total_earned = int(body.get("total_earned", 0))
            buildings_count = int(body.get("buildings_count", 0))
            dispensers_count = int(body.get("dispensers_count", 0))

            if not player_id:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "player_id required"})}

            cur.execute("""
                INSERT INTO t_p58229874_factory_tycoon_game.players
                    (player_id, balance, total_earned, buildings_count, dispensers_count, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (player_id) DO UPDATE SET
                    balance = EXCLUDED.balance,
                    total_earned = EXCLUDED.total_earned,
                    buildings_count = EXCLUDED.buildings_count,
                    dispensers_count = EXCLUDED.dispensers_count,
                    updated_at = NOW()
            """, (player_id, balance, total_earned, buildings_count, dispensers_count))
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        # GET — топ-50 по total_earned
        cur.execute("""
            SELECT player_id, balance, total_earned, buildings_count, dispensers_count
            FROM t_p58229874_factory_tycoon_game.players
            ORDER BY total_earned DESC
            LIMIT 50
        """)
        rows = cur.fetchall()
        players = [
            {
                "player_id": r[0],
                "balance": r[1],
                "total_earned": r[2],
                "buildings_count": r[3],
                "dispensers_count": r[4],
            }
            for r in rows
        ]
        return {"statusCode": 200, "headers": CORS, "body": json.dumps({"players": players})}

    finally:
        cur.close()
        conn.close()
