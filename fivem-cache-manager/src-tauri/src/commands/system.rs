use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
pub struct PrerequisitesStatus {
    pub steam: bool,
    pub discord: bool,
}

#[tauri::command]
pub fn check_prerequisites() -> PrerequisitesStatus {
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut steam = false;
    let mut discord = false;

    for process in sys.processes().values() {
        if let Some(name) = process.name().to_str() {
            let lower_name = name.to_lowercase();
            if lower_name == "steam.exe" || lower_name == "steam" {
                steam = true;
            }
            if lower_name == "discord.exe" || lower_name == "discord" {
                discord = true;
            }
        }
    }

    PrerequisitesStatus { steam, discord }
}
