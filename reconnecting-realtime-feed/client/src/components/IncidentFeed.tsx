import type { DisplayUpdate, UpdateSource } from "../types/update";

interface Props {
  updates: DisplayUpdate[];
}

const BADGE_LABEL: Record<UpdateSource, string> = {
  self: "you",
  live: "live",
  history: "history"
};

export function IncidentFeed({ updates }: Props) {
  if (updates.length === 0) {
    return <p className="feed-empty">No updates yet.</p>;
  }

  return (
    <ul className="feed-list">
      {updates.map((update) => (
        <li key={update.id} className={`feed-item feed-item--${update.source}`}>
          <span className="feed-item__sequence">#{update.sequence}</span>
          <span className="feed-item__message">{update.message}</span>
          <span className={`feed-item__badge feed-item__badge--${update.source}`}>
            {BADGE_LABEL[update.source]}
          </span>
          <time className="feed-item__timestamp" dateTime={update.createdAt}>
            {new Date(update.createdAt).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ul>
  );
}
