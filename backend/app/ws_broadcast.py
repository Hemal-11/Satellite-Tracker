# ws_broadcast.py

from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # { websocket: {"25544", "12345"} }
        self.connections: dict[WebSocket, set[str]] = {}

    # ---------------------------------------------------------
    # CONNECT
    # ---------------------------------------------------------
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections[websocket] = set()
        print("[WS] Client connected")

    # ---------------------------------------------------------
    # DISCONNECT
    # ---------------------------------------------------------
    def disconnect(self, websocket: WebSocket):
        if websocket in self.connections:
            self.connections.pop(websocket, None)
            print("[WS] Client disconnected")

    # ---------------------------------------------------------
    # SUBSCRIBE TO A SATELLITE (NORAD ID)
    # ---------------------------------------------------------
    def subscribe(self, websocket: WebSocket, norad_id: str):
        if websocket in self.connections:
            self.connections[websocket].add(norad_id)
            print(f"[WS] Subscribed: {norad_id}")

    # ---------------------------------------------------------
    # UNSUBSCRIBE FROM A SATELLITE (NORAD ID)
    # ---------------------------------------------------------
    def unsubscribe(self, websocket: WebSocket, norad_id: str):
        if websocket in self.connections:
            self.connections[websocket].discard(norad_id)
            print(f"[WS] Unsubscribed: {norad_id}")

    # ---------------------------------------------------------
    # BROADCAST POSITION TO SUBSCRIBED CLIENTS
    # ---------------------------------------------------------
    async def broadcast(self, message: str, norad_id: str = None):
        dead_clients = []

        for websocket, subscriptions in self.connections.items():
            try:
                # if message has NORAD filter, only send to subscribers
                if norad_id is None or norad_id in subscriptions:
                    await websocket.send_text(message)

            except Exception:
                # if sending fails, clean dead connection
                dead_clients.append(websocket)

        # remove dead clients
        for ws in dead_clients:
            self.disconnect(ws)


# Singleton instance
manager = ConnectionManager()
