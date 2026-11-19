import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T>(); const [error, setError] = useState("");
  const reload = useCallback(() => { if (path) api<T>(path).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message)); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
