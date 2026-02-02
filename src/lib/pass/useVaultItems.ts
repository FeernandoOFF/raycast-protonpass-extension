import { useMemo, useState, useEffect } from "react";
import { useExec } from "@raycast/utils";
import { getPassClient, type Item } from "./client";
import { useVaults } from "./useVaults";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function useVaultItems(cliPath: string, vaultName: string | undefined) {
  const client = useMemo(() => getPassClient(cliPath), [cliPath]);

  const cacheKey = vaultName ?? "all_vaults";
  const cachedItems = client.getCachedItems(cacheKey);

  const { vaults, isLoading: vaultsLoading } = useVaults(cliPath);

  // If vaultName is specified, we use useExec for that specific vault.
  const {
    data: singleVaultData,
    isLoading: singleVaultLoading,
    error: singleVaultError,
  } = useExec(cliPath, ["item", "list", vaultName || "", "--output=json"], {
    execute: !!vaultName,
  });

  // State for the "all vaults" case
  const [allVaultsItems, setAllVaultsItems] = useState<Item[] | null>(null);
  const [isAllVaultsLoading, setIsAllVaultsLoading] = useState(false);
  const [allVaultsError, setAllVaultsError] = useState<Error | undefined>();

  useEffect(() => {
    if (!vaultName && !vaultsLoading && vaults.length > 0) {
      let isMounted = true;
      async function fetchAll() {
        setIsAllVaultsLoading(true);
        setAllVaultsError(undefined);
        try {
          const fetchPromises = vaults.map(async (vault) => {
            const { stdout } = await execAsync(`${cliPath} item list "${vault.title}" --output=json`);
            return client.setItemsFromJson(vault.title, stdout);
          });
          const results = await Promise.all(fetchPromises);
          const allItems = results.flat();
          if (isMounted) {
            client.setItems("all_vaults", allItems);
            setAllVaultsItems(allItems);
          }
        } catch (e) {
          if (isMounted) setAllVaultsError(e as Error);
        } finally {
          if (isMounted) setIsAllVaultsLoading(false);
        }
      }
      fetchAll();
      return () => {
        isMounted = false;
      };
    }
  }, [vaultName, vaults, vaultsLoading, cliPath, client]);

  const items: Item[] = useMemo(() => {
    if (vaultName) {
      if (singleVaultData) {
        return client.setItemsFromJson(vaultName, singleVaultData);
      }
    } else {
      if (allVaultsItems) {
        return allVaultsItems;
      }
    }
    return cachedItems ?? [];
  }, [vaultName, singleVaultData, allVaultsItems, client, cachedItems]);

  const isLoading = vaultName ? singleVaultLoading : vaultsLoading || isAllVaultsLoading;
  const error = (vaultName ? singleVaultError : allVaultsError) || undefined;

  return { items, isLoading, error };
}