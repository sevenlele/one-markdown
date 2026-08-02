use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

/// A simple file watcher that monitors a single file for changes.
pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    /// Start watching a file. Returns a receiver that yields the file path whenever it changes.
    pub fn watch(path: &str) -> anyhow::Result<(Self, mpsc::Receiver<PathBuf>)> {
        let (tx, rx) = mpsc::channel();
        let path_buf = PathBuf::from(path);
        let watch_path = path_buf.clone();

        let mut watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) => {
                            // Only notify if the changed path matches our file
                            for changed_path in &event.paths {
                                if changed_path == &watch_path || changed_path.ends_with(&watch_path) {
                                    let _ = tx.send(changed_path.clone());
                                }
                            }
                        }
                        _ => {}
                    }
                }
            },
            notify::Config::default().with_poll_interval(Duration::from_secs(1)),
        )?;

        watcher.watch(
            path_buf.parent().unwrap_or(PathBuf::from(".").as_path()),
            RecursiveMode::NonRecursive,
        )?;

        Ok((Self { _watcher: watcher }, rx))
    }
}
