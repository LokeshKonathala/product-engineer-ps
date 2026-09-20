import { ConnectionStatus } from "./ConnectionStatus";
import { IncidentFeed } from "./IncidentFeed";
import { MessageInput } from "./MessageInput";
import { useIncidentSocket } from "../hooks/useIncidentSocket";

interface Props {
  label: string;
  roomId: string;
}

/**
 * One fully independent client identity: its own WebSocket, its own
 * connection state, its own feed. Rendering two of these for the same
 * roomId is equivalent to opening two separate browser tabs, but visible
 * side by side in one window so the live-sync/reconnect flow is easy to see.
 */
export function ClientPanel({ label, roomId }: Props) {
  const { updates, connectionState, lastError, resumeCursor, publish, simulateDisconnect, reconnect } =
    useIncidentSocket(roomId);
  const isConnected = connectionState === "connected";

  return (
    <section className="client-panel">
      <header className="client-panel__header">
        <h2>{label}</h2>
        <span className="client-panel__cursor" title="Resume checkpoint this client would send as ?after= on its next reconnect">
          cursor: {resumeCursor}
        </span>
      </header>

      <ConnectionStatus
        state={connectionState}
        onSimulateDisconnect={simulateDisconnect}
        onReconnect={reconnect}
      />

      {lastError && <p className="app__error">{lastError}</p>}

      <MessageInput onPublish={publish} disabled={!isConnected} />

      <IncidentFeed updates={updates} />
    </section>
  );
}
