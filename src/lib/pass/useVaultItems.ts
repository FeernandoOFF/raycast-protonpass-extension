import { useState, useEffect } from "react";
import { type Item, useClient } from "./client";
import { showToast, Toast } from "@raycast/api";

export function useVaultItems(vaultName: string | null) {
  const client = useClient()

  const [data, setData] = useState<Item[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchVaults = async () => {
      setIsLoading(true);
      const items = await client.getItems(vaultName);
      if (items) {
        try {
          setData(items);
        } catch(error: any) {
          setData(null);
          showToast({
            style: Toast.Style.Failure,
            title: "Error",
            message: error.message || "Something went wrong",
          });
        }
      }
      setIsLoading(false);
    };
    fetchVaults().catch((error)=> {
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: error.message || "Something went wrong",
      });
    });
  }, []);


  return { items: data, isLoading };
}