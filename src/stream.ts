import { useEffect, useState } from "react";
import type { Run } from "../shared/contracts";
import { terminal } from "../shared/contracts";
import { SSEDecoder, applyRunEvent, type StreamState } from "../shared/sse";
import { api } from "./api";
export function useRunStream(id: string | null, onDone: () => void) {
  const [run, setRun] = useState<Run | null>(null);
  const [connection, setConnection] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) {
      setRun(null);
      return;
    }
    let alive = true;
    const abort = new AbortController();
    let flush: ReturnType<typeof setInterval> | undefined;
    let current: Run;
    let state: StreamState;
    const commit = () => {
      if (alive && current) setRun({ ...current, answer: state.text });
    };
    void (async () => {
      try {
        const snapshot = await api<Run & { next_seq: number }>(`/runs/${id}`);
        if (!alive) return;
        current = snapshot;
        state = {
          runId: id,
          sequence: snapshot.next_seq,
          text: snapshot.answer,
          ended: terminal(snapshot.status),
        };
        commit();
        if (state.ended) {
          setConnection("已加载服务端记录");
          return;
        }
        flush = setInterval(commit, 50);
        while (alive && !state.ended) {
          try {
            setConnection("连接中");
            const response: Response = await fetch(
              `/api/runs/${id}/events?after=${state.sequence}`,
              { signal: abort.signal },
            );
            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.message ?? "事件连接失败");
            }
            if (!response.body) throw new Error("无事件流");
            setConnection("实时接收");
            const reader: ReadableStreamDefaultReader<Uint8Array> =
              response.body.getReader();
            const parser = new SSEDecoder();
            try {
              while (alive) {
                const { value, done } = await reader.read();
                if (done) break;
                for (const event of parser.push(value)) {
                  if (
                    event.runId !== id ||
                    event.sequence <= state.sequence ||
                    state.ended
                  )
                    continue;
                  state = applyRunEvent(state, event);
                  if (event.type === "status")
                    current = {
                      ...current,
                      status: event.payload.status as Run["status"],
                    };
                  if (event.type === "sources")
                    current = {
                      ...current,
                      refs: event.payload.sources as Run["refs"],
                    };
                  if (event.type === "done")
                    current = { ...current, status: "completed" };
                  if (event.type === "cancelled")
                    current = { ...current, status: "cancelled" };
                  if (event.type === "error")
                    current = {
                      ...current,
                      status: "failed",
                      error: String(event.payload.message),
                    };
                }
                if (state.ended) {
                  commit();
                  break;
                }
              }
            } finally {
              await reader.cancel().catch(() => undefined);
              reader.releaseLock();
            }
            if (!state.ended && alive) {
              setConnection("连接中断，正在恢复");
              await new Promise((resolve) => setTimeout(resolve, 700));
            }
          } catch (error) {
            if (abort.signal.aborted) return;
            setConnection(error instanceof Error ? error.message : "连接失败");
            await new Promise((resolve) => setTimeout(resolve, 1200));
            const latest = await api<Run & { next_seq: number }>(`/runs/${id}`);
            if (terminal(latest.status)) {
              current = latest;
              state = {
                runId: id,
                sequence: latest.next_seq,
                text: latest.answer,
                ended: true,
              };
              commit();
            }
          }
        }
        if (alive) {
          setConnection("运行已结束");
          onDone();
        }
      } catch (error) {
        if (alive) {
          setRun(null);
          onDone();
          setConnection(
            error instanceof Error ? error.message : "无法加载问答",
          );
        }
      } finally {
        if (flush) clearInterval(flush);
      }
    })();
    return () => {
      alive = false;
      abort.abort();
      if (flush) clearInterval(flush);
    };
    // onDone is deliberately stable through the parent callback.
  }, [id, attempt, onDone]);
  return { run, connection, retry: () => setAttempt((v) => v + 1) };
}
