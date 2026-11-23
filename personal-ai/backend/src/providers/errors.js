// An error whose message is safe and helpful to show in the chat window.
export class ProviderError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "ProviderError";
    this.status = status;
  }
}

export function isAbortError(err) {
  return err?.name === "AbortError" || err?.name === "APIUserAbortError";
}
