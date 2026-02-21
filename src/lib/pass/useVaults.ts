import { useEffect } from "react";
import { getPassClient } from "./client";
import { showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";

export function useVaults() {
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const client = getPassClient();
    const vaults = await client.getAllVaults();
    return vaults;
  });

  useEffect(() => {
    if (error) showToast(Toast.Style.Failure, "Error", error.message || "Something went wrong");
  }, [error]);

  return { vaults: data, isLoading, error, revalidate };
}
