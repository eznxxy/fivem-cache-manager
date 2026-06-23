fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "swapcache",
                "loadconfig",
                "saveconfig",
                "getserverfolders",
                "serverselected"
            ]))
    ).expect("failed to run build script");
}
