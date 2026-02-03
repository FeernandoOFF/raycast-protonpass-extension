import { useEffect, useState } from "react";
import { useClient, Vault } from "./client";
import { showToast, Toast } from "@raycast/api";

export function useVaults() {
  const client = useClient();

  const [data, setData] = useState<Vault[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchVaults = async () => {
      setIsLoading(true);
      const vaults = await client.getAllVaults();
      if (vaults) {
        try {
          setData(vaults);
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

  return { vaults: data, isLoading };
}