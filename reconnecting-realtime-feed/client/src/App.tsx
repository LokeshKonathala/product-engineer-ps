import { useState } from "react";
import { ClientPanel } from "./components/ClientPanel";
import { HowToTest } from "./components/HowToTest";

function getInitialRoomId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("room") ?? "INC-001";
}

export default function App() {
  const [roomId, setRoomId] = useState(getInitialRoomId());
  const [roomInput, setRoomInput] = useState(roomId);

  function switchRoom(nextRoomId: string) {
    const trimmed = nextRoomId.trim();
    if (!trimmed || trimmed === roomId) return;
    setRoomId(trimmed);
    const url = new URL(window.location.href);
    url.searchParams.set("room", trimmed);
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Incident Feed</h1>
        <form
          className="room-switcher"
          onSubmit={(e) => {
            e.preventDefault();
            switchRoom(roomInput);
          }}
        >
          <label htmlFor="room-id">Room:</label>
          <input id="room-id" value={roomInput} onChange={(e) => setRoomInput(e.target.value)} />
          <button type="submit">Join</button>
        </form>
      </header>

      <div className="app__room-id">Incident Room: {roomId}</div>

      <HowToTest />

      <ClientPanel label="Client" roomId={roomId} />
    </div>
  );
}
