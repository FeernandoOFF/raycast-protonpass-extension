import { getPassClient } from "./lib/pass/client";
import { isPassCliError } from "./lib/pass/types";

export default async function Command() {
  try {
    const client = getPassClient();

    await client.getAllVaults(true);
    await client.getItems(null, true);
  } catch (error) {
    if (isPassCliError(error)) {
      return;
    }

    throw error;
  }
}
