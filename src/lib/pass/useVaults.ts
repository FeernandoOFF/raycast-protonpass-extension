// useVaults.ts
import { useEffect, useMemo, useState } from "react";
import { getPassClient, type Vault } from "./client";
import { getPreferenceValues } from "@raycast/api";

export function useVaults() {
  const { cliPath } = getPreferenceValues<Preferences>();
  const client = useMemo(() => getPassClient(cliPath), [cliPath]);

  const [data, setData] = useState<Vault[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    const fetchVaults = async () => {
      setIsLoading(true);
      const vaults = await client.getAllVaults();
      if (vaults) {
        try {
          setData(vaults);
        } catch {
          setData(null);
          setError(Error("Someting went wrong"));
        }
      }
      setIsLoading(false);
    };
    fetchVaults().catch(setError);
  }, []);

  return { vaults: data, isLoading, error };
}