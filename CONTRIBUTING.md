# Contributing to AudioSpec_Analyzer

Thanks for your interest in contributing! This guide keeps changes safe,
reviewable, and consistent.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies (see the README for the exact commands).
3. Create a branch from `dev`:
   `git switch -c feature/<topic> dev`

## Branching model

We use a three-tier flow: `main` -> `dev` -> `feature/*`.

- `main` is always releasable. Do not commit to it directly.
- `dev` is the integration branch where features are validated.
- `feature/<topic>` is where you do the actual work.

Open pull requests against `dev` (not `main`).

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` a new feature
- `fix:` a bug fix
- `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `ci:`

Keep one logical change per commit, written in the imperative mood
(`add`, not `added`).

## Before you open a PR

- [ ] Code builds locally.
- [ ] Tests pass (if the project has tests).
- [ ] No secrets, credentials, or `.env` values are committed.
- [ ] The PR description explains the what and the why.

## Reporting bugs and requesting features

Open an issue using the provided templates. Include reproduction steps,
expected vs. actual behavior, and environment details.

## Code of Conduct

By participating you agree to uphold our
[Code of Conduct](./CODE_OF_CONDUCT.md).
