#!/usr/bin/env bash
# Count MY commits per day in private repos and write data/private-activity.json.
# Only {"YYYY-MM-DD": count} leaves this machine — no repo names, paths, messages or code.
# A commit cherry-picked onto several branches counts once (same author time + subject).
#
# Usage:
#   scripts/export-private-activity.sh /path/to/repo-a /path/to/repo-b
#   scripts/export-private-activity.sh            # reads paths from .private-repos (gitignored)
# Env:
#   AUTHOR  git --author regex (default: matches "Thịnh"/"Thinh")
#   TZ      day boundary timezone (default: Asia/Ho_Chi_Minh)
set -euo pipefail
cd "$(dirname "$0")/.."

AUTHOR="${AUTHOR:-Thịnh\|[Tt]hinh}"
export TZ="${TZ:-Asia/Ho_Chi_Minh}"

repos=("$@")
if [ ${#repos[@]} -eq 0 ] && [ -f .private-repos ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && [ "${line#\#}" = "$line" ] && repos+=("$line")
  done < .private-repos
fi
[ ${#repos[@]} -gt 0 ] || { echo "no repos: pass paths or create .private-repos" >&2; exit 1; }

for repo in "${repos[@]}"; do
  git -C "$repo" log --all --no-merges --author="$AUTHOR" \
    --date=format-local:%Y-%m-%d --format='%at %ad %s'
done | sort -u | awk '{print $2}' | sort | uniq -c | awk '
  BEGIN { printf "{\n" }
  { printf "%s  \"%s\": %d", (NR > 1 ? ",\n" : ""), $2, $1 }
  END { printf "\n}\n" }' > data/private-activity.json

echo "wrote data/private-activity.json ($(grep -c ':' data/private-activity.json) days)"
