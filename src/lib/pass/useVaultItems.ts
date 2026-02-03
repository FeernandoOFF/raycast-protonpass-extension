import { useEffect, } from "react";
import { useClient } from "./client";
import { showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";

export function useVaultItems(vaultName: string | null) {
  const client = useClient()


  const  { data, isLoading, error } =  usePromise(async () => {
    const items = await client.getItems(vaultName);
    return items
  });

  useEffect(() => {
    if(error) showToast(
      Toast.Style.Failure,
      "Error",
      error.message || "Something went wrong"
    )
  }, [error])

  return { items: data, isLoading };
}