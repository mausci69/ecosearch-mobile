import {
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
  launchCameraAsync,
  launchImageLibraryAsync,
  MediaTypeOptions,
  ImagePickerAsset,
} from "expo-image-picker";

export type PickSource = "camera" | "library";

/**
 * Opens camera or gallery and returns a FormData with the selected image,
 * ready to POST to /ocr_extract as { file: (image) }.
 * Returns null if the user cancels.
 */
export async function pickImageAsFormData(source: PickSource): Promise<FormData | null> {
  const asset = await pickImageAsset(source);
  if (!asset) return null;
  return buildFormDataFromAssets([asset]);
}

/** Pick a single image and return the raw ImagePickerAsset (or null if cancelled). */
export async function pickImageAsset(source: PickSource): Promise<ImagePickerAsset | null> {
  if (source === "camera") {
    const { granted } = await requestCameraPermissionsAsync();
    if (!granted) throw new Error("Camera permission denied");
  } else {
    const { granted } = await requestMediaLibraryPermissionsAsync();
    if (!granted) throw new Error("Media library permission denied");
  }

  const pickerOpts = {
    mediaTypes: MediaTypeOptions.Images,
    quality: 0.8 as const,
    allowsEditing: false,
    exif: false,
  };

  const result =
    source === "camera"
      ? await launchCameraAsync(pickerOpts)
      : await launchImageLibraryAsync(pickerOpts);

  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0]!;
}

/**
 * Build a multipart FormData for multiple images.
 * Appends each page under the "files" key expected by /ocr_extract.
 */
export function buildFormDataFromAssets(assets: ImagePickerAsset[]): FormData {
  const form = new FormData();
  assets.forEach((asset, idx) => {
    form.append("files", {
      uri: asset.uri,
      name: asset.fileName ?? `scan_${idx + 1}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    } as any);
  });
  return form;
}