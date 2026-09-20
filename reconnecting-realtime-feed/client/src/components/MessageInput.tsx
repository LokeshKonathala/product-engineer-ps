import { useState, type FormEvent } from "react";

interface Props {
  onPublish: (message: string) => Promise<void>;
  disabled?: boolean;
}

export function MessageInput({ onPublish, disabled }: Props) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);
    try {
      await onPublish(trimmed);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish update");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Post an incident update..."
        disabled={disabled || submitting}
        maxLength={2000}
      />
      <button type="submit" disabled={disabled || submitting || value.trim().length === 0}>
        {submitting ? "Publishing..." : "Publish"}
      </button>
      {error && <p className="message-input__error">{error}</p>}
    </form>
  );
}
