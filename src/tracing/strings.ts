/** Linear scans on provider-controlled strings; avoid regex restart backtracking. */
export function stripTrailingSlashes(text: string): string {
  let end = text.length;
  while (end && text[end - 1] === "/") end--;
  return text.slice(0, end);
}
const LOCAL = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+/=?^_`{|}~-",
);
const DOMAIN = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-",
);
export function replaceEmails(
  text: string,
  replace: (email: string) => string,
): string {
  const chunks: string[] = [];
  let cursor = 0,
    copied = 0;
  while (cursor < text.length) {
    const at = text.indexOf("@", cursor);
    if (at < 0) break;
    let start = at,
      end = at + 1;
    const local = (char: string) =>
      LOCAL.has(char) || (char.charCodeAt(0) >= 128 && !/\s/u.test(char));
    const domainChar = (char: string) =>
      DOMAIN.has(char) ||
      char === "@" ||
      (char.charCodeAt(0) >= 128 && !/\s/u.test(char));
    while (start > copied && local(text[start - 1])) start--;
    // An ambiguous token with multiple @ signs is masked as a whole rather than
    // leaving a suffix of an adjacent address in selected text.
    while (end < text.length && domainChar(text[end])) end++;
    // Trim sentence punctuation; require a plausible domain suffix.
    while (end > at + 1 && text[end - 1] === ".") end--;
    const domain = text.slice(text.lastIndexOf("@", end - 1) + 1, end),
      dot = domain.lastIndexOf(".");
    if (
      start < at &&
      dot > 0 &&
      /^(?:[\p{L}\p{M}]{2}|[^\x00-\x7F])/u.test(domain.slice(dot + 1))
    ) {
      chunks.push(text.slice(copied, start), replace(text.slice(start, end)));
      copied = end;
    }
    cursor = Math.max(at + 1, end);
  }
  chunks.push(text.slice(copied));
  return chunks.join("");
}
export function extractEmails(text: string): string[] {
  const emails: string[] = [];
  replaceEmails(text, (email) => {
    emails.push(email);
    return "";
  });
  return emails;
}
