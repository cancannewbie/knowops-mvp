import type { RunEvent } from "./contracts";
export class TransportError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Transport chunks are neither UTF-8 boundaries nor SSE event boundaries. */
export class SSEDecoder {
  private decoder = new TextDecoder();
  private buffer = "";
  push(bytes: Uint8Array, final = false): RunEvent[] {
    this.buffer += this.decoder.decode(bytes, { stream: !final });
    const result: RunEvent[] = [];
    while (true) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.transportError)
          throw new TransportError(
            parsed.transportError.code,
            parsed.transportError.message,
          );
        result.push(parsed as RunEvent);
      }
    }
    return result;
  }
}
export type StreamState = {
  runId: string;
  sequence: number;
  text: string;
  ended: boolean;
};
export function applyRunEvent(
  state: StreamState,
  event: RunEvent,
): StreamState {
  if (
    event.runId !== state.runId ||
    event.sequence <= state.sequence ||
    state.ended
  )
    return state;
  if (event.sequence !== state.sequence + 1)
    throw new Error("事件序号存在间隙，请重新连接");
  return {
    ...state,
    sequence: event.sequence,
    text:
      event.type === "delta"
        ? state.text + String(event.payload.text ?? "")
        : state.text,
    ended: ["done", "error", "cancelled"].includes(event.type),
  };
}
