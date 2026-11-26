import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';

const DOWNLOAD_FOLDER_URI_KEY = '@photo-de-jaldi/android-download-folder-uri';
let pendingSave: Promise<void> = Promise.resolve();

export async function getAndroidDownloadFolderUri(): Promise<string | null> {
  return AsyncStorage.getItem(DOWNLOAD_FOLDER_URI_KEY);
}

export async function chooseAndroidDownloadFolder(): Promise<string | null> {
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!result.granted) return null;

  await AsyncStorage.setItem(DOWNLOAD_FOLDER_URI_KEY, result.directoryUri);
  return result.directoryUri;
}

export async function clearAndroidDownloadFolder(): Promise<void> {
  await AsyncStorage.removeItem(DOWNLOAD_FOLDER_URI_KEY);
}

export function saveCachedFileToAndroidFolder(
  cacheFileUri: string,
  folderUri: string,
  fileName: string
): Promise<{ folderName: string; fileName: string }> {
  const saveOperation = pendingSave.then(() =>
    saveCachedFileToAndroidFolderNow(cacheFileUri, folderUri, fileName)
  );
  pendingSave = saveOperation.then(
    () => undefined,
    () => undefined
  );
  return saveOperation;
}

async function saveCachedFileToAndroidFolderNow(
  cacheFileUri: string,
  folderUri: string,
  fileName: string
): Promise<{ folderName: string; fileName: string }> {
  const directory = new Directory(folderUri);
  const folderName = directory.name;
  const existingNames = new Set(directory.list().map((entry) => entry.name.toLowerCase()));
  const uniqueName = getAvailableFileName(fileName, existingNames);
  const destination = directory.createFile(uniqueName, 'application/octet-stream');
  let savedFileName = uniqueName;

  try {
    savedFileName = destination.name;
    await new File(cacheFileUri).copy(destination, { overwrite: true });
  } catch (error) {
    try {
      destination.delete();
    } catch (cleanupError) {
      console.warn('Could not remove an incomplete Android download copy.', cleanupError);
    }
    throw error;
  }

  try {
    await FileSystem.deleteAsync(cacheFileUri, { idempotent: true });
  } catch (error) {
    console.warn('Could not remove the cached Android download after saving.', error);
  }

  return { folderName, fileName: savedFileName };
}

function getAvailableFileName(fileName: string, existingNames: Set<string>): string {
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
  if (!existingNames.has(safeName.toLowerCase())) return safeName;

  const extensionIndex = safeName.lastIndexOf('.');
  const baseName = extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : '';

  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${baseName} (${suffix})${extension}`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }
}
