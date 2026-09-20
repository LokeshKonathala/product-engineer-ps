export function HowToTest() {
  return (
    <details className="how-to-test" open>
      <summary>How to test this demo</summary>

      <p>
        Open this page's URL in two separate browser tabs (or windows) with the same{" "}
        <strong>Room</strong> — each tab opens its own independent WebSocket connection, the same
        as two different people watching this incident.
      </p>

      <ol>
        <li>
          <strong>Live sync.</strong> Publish a message from Tab 1. It appears in Tab 2's feed
          immediately, with no refresh.
        </li>
        <li>
          <strong>Connection state.</strong> Click <em>Simulate disconnect</em> in Tab 2.
          Its status turns 🔴 Disconnected and stays there — auto-reconnect is held off — until
          you click <em>Reconnect</em>, so you have as long as you need to set up the next step.
        </li>
        <li>
          <strong>Missed-update recovery.</strong> While Tab 2 shows Disconnected, publish
          2–3 more messages from Tab 1. Then click <em>Reconnect</em> in Tab 2 — it goes
          through 🟡 Reconnecting... and recovers everything it missed.
        </li>
        <li>
          <strong>No duplicates.</strong> After Tab 2 reconnects, check its feed — each message
          appears exactly once, even though the same update may have arrived via both replay and
          the live socket.
        </li>
        <li>
          <strong>Stable order.</strong> The <code>#</code> number on each item is a sequence
          assigned by the database at write time. Items are always shown in that order, never by
          arrival time.
        </li>
      </ol>

      <p className="how-to-test__legend">
        Badges show how an update reached that client:{" "}
        <span className="feed-item__badge feed-item__badge--self">you</span> published it here,{" "}
        <span className="feed-item__badge feed-item__badge--live">live</span> arrived over the
        open socket, <span className="feed-item__badge feed-item__badge--history">history</span>{" "}
        arrived via replay (initial load or reconnect recovery). "cursor: N" is the checkpoint
        each client would resume from if it reconnected right now.
      </p>
    </details>
  );
}
