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
