import type { ConnectionState } from "../types/update";

const LABELS: Record<ConnectionState, string> = {
  connecting: "🟡 Connecting...",
  connected: "🟢 Connected",
  reconnecting: "🟡 Reconnecting...",
  disconnected: "🔴 Disconnected"
};

interface Props {
  state: ConnectionState;
  onSimulateDisconnect: () => void;
  onReconnect: () => void;
}

export function ConnectionStatus({ state, onSimulateDisconnect, onReconnect }: Props) {
  const isHeldDisconnected = state === "disconnected";

  return (
    <div className={`connection-status connection-status--${state}`}>
      <span>{LABELS[state]}</span>
      {isHeldDisconnected ? (
        <button
          type="button"
          className="connection-status__dev-button"
          onClick={onReconnect}
          title="Development-only: resume the WebSocket connection"
        >
          Reconnect
        </button>
      ) : (
        <button
          type="button"
          className="connection-status__dev-button"
          onClick={onSimulateDisconnect}
          title="Development-only: force-close the WebSocket and hold it closed until Reconnect is clicked"
        >
          Simulate disconnect
        </button>
      )}
    </div>
  );
}
