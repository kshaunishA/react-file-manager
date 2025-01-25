const FileSystem = require("../models/FileSystem.model");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

const recursiveCopy = async (sourceItem, destinationFolder) => {
  const copyItem = new FileSystem({
    name: sourceItem.name,
    isDirectory: sourceItem.isDirectory,
    path: `${destinationFolder?.path ?? ""}/${sourceItem.name}`,
    parentId: destinationFolder?._id || null,
    size: sourceItem.size,
    mimeType: sourceItem.mimeType,
  });

  await copyItem.save();

  const children = await FileSystem.find({ parentId: sourceItem._id });

  for (const child of children) {
    await recursiveCopy(child, copyItem);
  }
};

const getUniqueFilePath = async (basePath, fileName) => {
  let uniquePath = path.join(basePath, fileName);

  const ext = path.extname(fileName);
  const name = path.basename(fileName, ext);

  // Check if the file already exists and append "copy" if it does
  if (await FileSystem.findOne({ path: uniquePath })) {
    uniquePath = path.join(basePath, `${name} copy${ext}`);
  }

  return uniquePath;
};

const copyItem = async (req, res) => {
  const { sourceIds, destinationId } = req.body;
  const isRootDestination = !destinationId;

  if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body, expected an array of sourceIds." });
  }

  try {
    const validIds = sourceIds.filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    if (validIds.length !== sourceIds.length) {
      return res
        .status(400)
        .json({ error: "One or more of the provided sourceIds are invalid." });
    }

    const sourceItems = await FileSystem.find({ _id: { $in: validIds } });
    if (sourceItems.length !== validIds.length) {
      return res
        .status(404)
        .json({ error: "One or more of the provided sourceIds do not exist." });
    }

    const copyPromises = sourceItems.map(async (sourceItem) => {
      const srcFullPath = path.join(process.env.BASE_PATH, sourceItem.path);
      let destFullPath;

      if (isRootDestination) {
        destFullPath = await getUniqueFilePath(
          process.env.BASE_PATH,
          sourceItem.name
        );
        await fs.promises.cp(srcFullPath, destFullPath, { recursive: true });
        await recursiveCopy(sourceItem, null);
      } else {
        const destinationFolder = await FileSystem.findById(destinationId);
        if (!destinationFolder || !destinationFolder.isDirectory) {
          throw new Error("Invalid destinationId!");
        }

        destFullPath = await getUniqueFilePath(
          path.join(process.env.BASE_PATH, destinationFolder.path),
          sourceItem.name
        );
        await fs.promises.cp(srcFullPath, destFullPath, { recursive: true });
        await recursiveCopy(sourceItem, destinationFolder);
      }
    });

    try {
      await Promise.all(copyPromises);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json({ message: "Item(s) copied successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = copyItem;
