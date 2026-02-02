// useVaults.ts
import { useMemo } from "react";
import { useExec } from "@raycast/utils";
import { getPassClient, type Vault } from "./client";

export function useVaults(cliPath: string) {
  const client = useMemo(() => getPassClient(cliPath), [cliPath]);
  const cachedVaults = client.getCachedVaults();

  const { command, args } = client.buildListVaultsCommand();
  const { data, isLoading, error } = useExec(command, args);

  // If we have fresh data, prefer it. Otherwise fall back to cache.
  const vaults: Vault[] = useMemo(() => {
    if (data) {
      try {
        return client.setVaultsFromJson(data);
      } catch {
        return cachedVaults ?? [];
      }
    }
    return cachedVaults ?? [];
  }, [data, client, cachedVaults]);

  const effectiveLoading = cachedVaults ? false : isLoading;

  return { vaults, isLoading: effectiveLoading, error };
}