const express = require("express");
const mongoose = require("mongoose");
const posts = require("./routes/posts");
const users = require("./routes/users");
const community = require("./routes/community");
const auth = require("./routes/auth");
const images = require("./routes/images");
const drafts = require("./routes/drafts");
const category = require("./routes/category");
const rule = require("./routes/rule");
var cors = require("cors");
const cookieParser = require("cookie-parser");
const app = express();
const http = require("http").Server(app);
const path = require("path");
const { Post } = require("./models/Post");
const { User } = require("./models/User");
const io = require("socket.io")(http);
const bodyParser = require("body-parser");

require("dotenv").config();

io.on("connection", function(sockets) {
  sockets.on("post-vote", async function({ action, status, postId, userId }) {
    let counter = 0;

    if (action === "like" && status === "") {
      counter = 1;
      status = "like";
    } else if (action === "like" && status === "like") {
      counter = -1;
      status = "";
    } else if (action === "like" && status === "unlike") {
      counter = 2;
      status = "like";
    } else if (action === "unlike" && status === "") {
      counter = -1;
      status = "unlike";
    } else if (action === "unlike" && status === "unlike") {
      counter = 1;
      status = "";
    } else if (action === "unlike" && status === "like") {
      counter = -2;
      status = "unlike";
    } else {
      counter = 0;
      status = "";
    }

    io.emit("post-vote", { status, counter, postId, userId });

    let post = await Post.findById(postId);
    let user = await User.findById(userId);

    if (action === "like") {
      if (counter === 1) user.likedPosts = [...user.likedPosts, postId];
      if (counter === -1) user.likedPosts.splice(post._id, 1);
      if (counter === 2) {
        user.likedPosts = [...user.likedPosts, postId];
        user.dislikedPosts.splice(post._id, 1);
      }
    } else if (action === "unlike") {
      if (counter === -1)
        user.dislikedPosts = [...user.dislikedPosts, post._id];
      if (counter === 1) user.dislikedPosts.splice(post._id, 1);
      if (counter === -2) {
        user.likedPosts.splice(post._id, 1);
        user.dislikedPosts = [...user.dislikedPosts, post._id];
      }
    }
    if (post.votes !== undefined) {
      post.votes = post.votes + counter;
    }

    await post.save();
    await user.save();
  });
});

app.use(bodyParser.json());
app.use(cookieParser());
const corsOptions = {
  credentials: true, // This is important.
  origin: true,
}

app.use(cors(corsOptions));

app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "uploads/images")));
app.use("/assets", express.static(path.join(__dirname, "uploads/assets")));
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGO_URL, {
})
  .then(() => {
    console.log("Connected to db!")
  })
  .catch((err) => {
    console.log('Error on start: ' + err.stack);
    process.exit(1);
  });

app.use("/api/posts", posts);
app.use("/api/users", users);
app.use("/api/community", community);
app.use("/api/auth", auth);
app.use("/api/images/", images);
app.use("/api/drafts/", drafts);
app.use("/api/category/", category);
app.use("/api/rules/", rule);

const port = process.env.PORT || 4000;
http.listen(port, () => {
  console.log("Listening on port " + port + "...");
});
