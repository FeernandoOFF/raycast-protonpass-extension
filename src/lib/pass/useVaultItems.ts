import { useMemo, useState, useEffect } from "react";
import { getPassClient, type Item } from "./client";
import { getPreferenceValues } from "@raycast/api";

export function useVaultItems(vaultName: string | null) {
  const { cliPath } = getPreferenceValues<Preferences>();
  const client = useMemo(() => getPassClient(cliPath), [cliPath]);

  const [data, setData] = useState<Item[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();



  useEffect(() => {
    const fetchVaults = async () => {
      setIsLoading(true);
      const items = await client.getItems(vaultName);
      if (items) {
        try {
          console.log(">> Got ", items.length);
          setData(items);
        } catch {
          setData(null);
          setError(Error("Something went wrong"));
        }
      }
      setIsLoading(false);
    };
    fetchVaults().catch(setError);
  }, []);


  return { items: data, isLoading, error };
}