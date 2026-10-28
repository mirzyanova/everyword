# ChatGPT → Everyword: adding vocabulary from a separate chat

This document is a technical handoff for a ChatGPT tutor with the user's **connected Supabase app**.

## Intent

Discuss and clarify English vocabulary normally. **Only when the user explicitly asks** to add the agreed words to Everyword, write the cards directly into Supabase. Do not ask the user to copy lists into the website, download files, or manually edit GitHub.

- Supabase project: `Everyword`
- Project ID: `hdczcqtclhxygdlvfibh`
- Table: `public.everyword_cards`
- Site: https://mirzyanova.github.io/everyword/
- Auth accounts: `auth.users`

## Account safety

Each Everyword user has a distinct `auth.users.id`. **Do not guess the target user from the first database row**, especially after the website is shared with friends.

At initial setup, if the project contains exactly one user, establish that this is the user's Everyword account. If multiple users exist or any uncertainty remains, ask for the email the user used to sign into Everyword, resolve it to exactly one `auth.users.id`, and retain that association for this chat. Do not insert anything when the target account is ambiguous.

**Never expose** `service_role` / secret API keys, change login settings, or use public client credentials for privileged writes. The Supabase connector's `execute_sql` operates server-side with permissions; its use must be authorized by the user's explicit request. The website itself uses a publishable key and row-level security (RLS).

## Card format

Every row must contain:
- `id`: fresh UUID, identical to `payload.id` (string)
- `user_id`: verified target user's `auth.users.id`
- `payload`: JSON object with these fields:
  - `id`: UUID string
  - `ru`: Russian meaning or natural cue, as discussed
  - `en`: English word/phrase, as discussed
  - `example`: natural English example (or `""`)
  - `exampleRu`: natural Russian translation of example (or `""`)
  - `note`: usage, pronunciation or nuance (or `""`)
  - `createdAt` and `updatedAt`: current ISO-8601 datetime strings
  - `fsrs`: JSON null
  - `history`: empty JSON array
- `updated_at`: current timestamp

Use `gen_random_uuid()` to produce the UUID; use it consistently in the row and payload. When generating SQL with user-supplied wording, safely quote and escape all SQL/JSON literals. Use the Supabase `execute_sql` tool with a single transaction for a batch. Do not give the user raw SQL as the result: **execute the insertion**.

## Duplicate detection

Before inserting, examine cards belonging to the verified `user_id`. Skip existing RU+EN pairs (case-insensitive comparison after trimming). If the English expression exists with a materially different Russian meaning, ask whether this represents a new sense or should enrich the existing card. Never overwrite existing `fsrs` or `history` while adding vocabulary.

Use the final approved meanings/examples from the chat rather than preliminary guesses. If the meaning of a word remains unresolved, ask before adding it.

## After insertion

Use a read-only `SELECT` to verify the inserted cards by ID and `user_id`. Report how many were added and how many duplicates were skipped. Do not claim success before verification. The website syncs the authenticated user's cards on focus and approximately every 30 seconds while visible. If needed, the user can open **Аккаунт → Синхронизировать сейчас**.

## One-time instruction for the tutor chat

> When I say “Добавь эти слова в Everyword”, use my connected Supabase app to save the words/expressions we have just agreed on as flashcards, following this document. Confirm actual insertion, not merely preparation. Do not add anything until I explicitly ask.

## Thematic shelves ("Полка")

The user can manually create thematic shelves in Everyword, and can **explicitly** ask ChatGPT to create or update a shelf (for example, "Собери полку 'Для работы' из моих существующих слов").

Project ID is the same: `hdczcqtclhxygdlvfibh`.

Table: `public.everyword_shelves`.

Columns: `id uuid`, `user_id uuid`, `payload jsonb`, `updated_at timestamptz`.

Payload contract:
```json
{
  "id": "<same UUID as row id>",
  "title": "Для работы",
  "description": "Useful phrases for meetings",
  "cardIds": ["<existing card UUID>", "<another existing card UUID>"],
  "createdAt": "<ISO 8601 UTC timestamp>",
  "updatedAt": "<ISO 8601 UTC timestamp>"
}
```

For shelf operations:
1. Verify the **same target authenticated user** as for the cards. Never access or modify shelves belonging to other site users.
2. Search `everyword_cards` for **that user's** existing active cards; only use those real UUIDs in `payload.cardIds`. Never fabricate card UUIDs. Ignore cards with a non-null `payload.deletedAt`.
3. If the user asks to create a shelf, choose a unique UUID for the shelf and save the row with matching `payload.id`.
4. If updating a shelf, fetch its existing payload first, keep `id`, `createdAt`, and other fields, change `cardIds` and `updatedAt`; never overwrite a newer shelf from stale data. Check for a shelf with the same name so you don't accidentally create duplicates.
5. A card may be present on multiple shelves; membership does not alter its learning progress.
6. **Do not create or update a shelf until the user explicitly requests it.** If the request is vague or the selection criteria are uncertain, propose the list for approval.
7. Verify with a read-only query and report how many cards are in the shelf. The site syncs shelves on focus / periodic refresh, or by going to **Аккаунт → Синхронизировать сейчас**.

A shelf can be deleted in the UI using a soft-delete marker `payload.deletedAt` (ISO timestamp) and a fresh `updatedAt`. ChatGPT should not hard-delete rows unless the user explicitly requests permanent deletion and the consequences have been explained.
