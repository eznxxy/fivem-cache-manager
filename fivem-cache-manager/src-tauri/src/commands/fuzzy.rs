// commands/fuzzy.rs — Fuzzy matching logic for server names vs folder names

/// Normalize string by converting to lowercase, keeping only alphanumeric chars and spaces,
/// and collapsing consecutive whitespaces.
pub fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Calculate the Levenshtein distance between two strings.
pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let len_a = a_chars.len();
    let len_b = b_chars.len();

    let mut dp = vec![vec![0; len_b + 1]; len_a + 1];

    for i in 0..=len_a {
        dp[i][0] = i;
    }
    for j in 0..=len_b {
        dp[0][j] = j;
    }

    for i in 1..=len_a {
        for j in 1..=len_b {
            let cost = if a_chars[i - 1] == b_chars[j - 1] { 0 } else { 1 };
            dp[i][j] = std::cmp::min(
                dp[i - 1][j] + 1, // deletion
                std::cmp::min(
                    dp[i][j - 1] + 1, // insertion
                    dp[i - 1][j - 1] + cost, // substitution
                ),
            );
        }
    }

    dp[len_a][len_b]
}

/// Match a server name against a list of directory names.
/// Priority:
/// 1. Exact normalized match
/// 2. Normalized contains match (server name contains folder name, or vice versa)
/// 3. Minimum Levenshtein distance (threshold <= 3)
pub fn fuzzy_match(server_name: &str, folders: &[String]) -> Option<String> {
    let norm_server = normalize(server_name);
    if norm_server.is_empty() {
        return None;
    }

    // 1. Exact match
    for folder in folders {
        if normalize(folder) == norm_server {
            return Some(folder.clone());
        }
    }

    // 2. Contains match
    for folder in folders {
        let norm_folder = normalize(folder);
        if !norm_folder.is_empty() && (norm_server.contains(&norm_folder) || norm_folder.contains(&norm_server)) {
            return Some(folder.clone());
        }
    }

    // 3. Levenshtein distance <= 3
    let mut best_match: Option<(&String, usize)> = None;
    for folder in folders {
        let norm_folder = normalize(folder);
        if norm_folder.is_empty() {
            continue;
        }
        let dist = levenshtein_distance(&norm_server, &norm_folder);
        if dist <= 3 {
            match best_match {
                None => best_match = Some((folder, dist)),
                Some((_, best_dist)) if dist < best_dist => best_match = Some((folder, dist)),
                _ => {}
            }
        }
    }

    best_match.map(|(folder, _)| folder.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize() {
        assert_eq!(normalize("Epic! Roleplay @2026"), "epic roleplay 2026");
        assert_eq!(normalize("  Indo   _  RP   "), "indo rp");
        assert_eq!(normalize("Server [ID] - Official #1"), "server id official 1");
    }

    #[test]
    fn test_exact_match() {
        let folders = vec!["Epic RP".to_string(), "Indo RP".to_string()];
        assert_eq!(fuzzy_match("Epic RP", &folders), Some("Epic RP".to_string()));
        assert_eq!(fuzzy_match("epic rp", &folders), Some("Epic RP".to_string()));
        assert_eq!(fuzzy_match("Epic! RP...", &folders), Some("Epic RP".to_string()));
    }

    #[test]
    fn test_contains_match() {
        let folders = vec!["Epic Roleplay Indonesia".to_string(), "Indo RP".to_string()];
        assert_eq!(
            fuzzy_match("Epic Roleplay Indonesia [UPDATING]", &folders),
            Some("Epic Roleplay Indonesia".to_string())
        );
        assert_eq!(
            fuzzy_match("Epic Roleplay", &folders),
            Some("Epic Roleplay Indonesia".to_string())
        );
    }

    #[test]
    fn test_levenshtein_match() {
        let folders = vec!["Epic RP".to_string(), "Legacy RP".to_string()];
        // Distance 1 (space removed)
        assert_eq!(fuzzy_match("EpicRP", &folders), Some("Epic RP".to_string()));
        // Distance 1 (typo)
        assert_eq!(fuzzy_match("Epik RP", &folders), Some("Epic RP".to_string()));
    }

    #[test]
    fn test_no_match() {
        let folders = vec!["Epic RP".to_string(), "Legacy RP".to_string()];
        assert_eq!(fuzzy_match("Kingdom Roleplay", &folders), None);
    }
}
