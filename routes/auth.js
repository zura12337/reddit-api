const express = require("express");
const router = express.Router();
const { User } = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

router.post("/", async (req, res) => {
  let user = await User.findOne({ email: req.body.email });
  if (!user) return res.status(400).send("Invalid Email or Password");

  const validPassword = await bcrypt.compare(req.body.password, user.password);
  if (!validPassword) return res.status(400).send("Invalid Email or Password");

  user.active = true;

  await user.save();

  const token = user.generateAuthToken();

  res.cookie("token", token, { httpOnly: true }).send(token);
});

router.post("/google", async (req, res) => {
  const token = req.body.tokenId;
  const decoded = jwt.decode(token);

  let user = await User.findOne({ email: decoded.email });
  if (!user) return res.status(400).send("User not registered");

  user.active = true;
  await user.save();

  const currentTime = Math.floor(Date.now() / 1000);
  if (currentTime < decoded.exp) {
    let token = user.generateAuthToken();

    res.cookie("token", token, { httpOnly: true }).send(token);
  } else {
    res.status(400).send("Cann't Login.");
  }
});

module.exports = router;
