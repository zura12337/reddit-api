const express = require("express");
const router = express.Router();
const { Community, validate } = require("../models/Community");
const { User } = require("../models/User");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const _ = require("lodash");
const cron = require("node-cron");

cron.schedule("* * * * *", async () => {
  const communities = await Community.find({});
  const date = Math.floor(Date.now() / 1000);
  communities.forEach(async (community) => {
    if (community.banned && community.banned.length > 0) {
      community.banned.forEach((bannedUser, i) => {
        if (!bannedUser.permanent) {
          if (bannedUser.until < date) {
            community.banned.splice(i, 1);
          }
        }
      });
    }
    await community.save();
  });
});

router.get("/", async (req, res) => {
  let community;
  if (req.cookies.token) {
    auth(req, res);
    community = await Community.find({ "banned.user": { $ne: req.user._id } });
  } else {
    community = await Community.find();
  }
  community.reverse();

  res.send(community);
});

router.get("/trending", async (req, res) => {
  const limit = parseInt(req.query.limit);

  let community;

  if(req.cookies.token) {
    auth(req, res);
    community = await Community.find({ "banned.user": { $ne: req.user._id } })
      .sort({ membersCount: 1 })
      .limit(limit ? limit : undefined);
  } else {
    community = await Community.find()
      .sort({ membersCount: 1 })
      .limit(limit ? limit : undefined);
  }
  res.send(community);
});

router.get("/trending/:category", async (req, res) => {
  let community;
  if(req.cookies.token) {
    auth(req, res);
    community = await Community.find({
      "banned.user": { $ne: req.user._id },
      category: req.params.category,
    }).sort({
      membersCount: 1,
    });
  } else {
    community = await Community.find({
      category: req.params.category,
    }).sort({
      membersCount: 1,
    });
  }

  if (community.length == 0) res.status(400).send("Communities not found.");

  res.send(community);
});

router.post("/", auth, async (req, res) => {
  const { error } = validate(req.body);
  if (error) {
    res.status(400).send(error.details[0].message);
  } else {
    let community = await Community.findOne({
      username: req.body.name.split(" ").join(""),
    });
    if (community) {
      res.status(400).send("Community with given name already exists.");
    } else {
      community = await new Community({
        ...req.body,
      });
      community.members = [req.user._id];
      community.moderators = [req.user._id];
      community.createdBy = req.user._id;
      community.username = community.name.split(" ").join("");
      community.save();

      let user = await User.findById(req.user._id);
      user.joined = [...user.joined, community._id];
      user.createdCommunities = [...user.createdCommunities, community._id];
      user.save();

      res.send(community);
    }
  }
});

router.get("/:username", async (req, res) => {
  if(req.cookies.token) {
    auth(req, res)
  }
  await Community.findOne({
    username: req.params.username,
  })
    .populate({
      path: "posts",
      model: "Post",
      populate: [
        {
          path: "postedTo",
          model: "Community",
        },
        {
          path: "postedBy",
          model: "User",
        },
      ],
    })
    .populate({ path: "posts.postedTo", model: "Community" })
    .populate({ path: "posts.postedBy", model: "User" })
    .populate({ path: "members", model: "User" })
    .populate({ path: "moderators", model: "User" })
    .populate({ path: "invitedModerators", model: "User" })
    .populate({ path: "createdBy", model: "User" })
    .then((community) => {
      if(req.user) {
        community.banned.forEach(bannedUser => {
          if(bannedUser.user.equals(req.user._id)) {
            return res.send({ code: 403, message: "You don't have permissions to see this page." })
          } else {
            return res.send(community);
          }
        }) 
        if(community.banned.length === 0) return res.send(community);
      } else {
        return res.send(community);
      }
    });
});

router.post("/invite-mod/", auth, async (req, res) => {
  const user = await User.findOne(
    { username: req.body.username },
    (err, user) => {
      if (!user) {
        return res.status(400).send("User not found with given username");
      }
    }
  );
  const community = await Community.findById(req.body.id);

  community.moderators.forEach((moderator) => {
    if (moderator.equals(user._id)) {
      return res
        .status(400)
        .send(`User is already r/${community.username}'s moderator.`);
    } else {
    }
  });

  if (user && community.invitedModerators) {
    community.invitedModerators = [user._id, ...community.invitedModerators];
  } else if (user) {
    community.invitedModerators = [uesr._id];
  }

  await community.save();

  return res.send(community);
});

router.post("/answer-mod/", auth, async (req, res) => {
  let user;
  if (req.body.userId) {
    user = await User.findById(req.body.userId);
  } else {
    user = await User.findById(req.user._id);
  }
  const community = await Community.findById(req.body.communityId);

  community.invitedModerators = community.invitedModerators.filter(
    (moderator) => !moderator.equals(req.user._id)
  );

  if (req.body.answer) {
    community.moderators = [req.user._id, ...community.moderators];

    user.createdCommunities = user.createdCommunities
      ? [community._id, ...user.createdCommunities]
      : [community._id];
  }
  await community.save();
  await user.save();

  res.send(community);
});

router.post("/:id/join", auth, async (req, res) => {
  let user = await User.findById(req.user._id);
  if (!user) return res.status(400).send("Bad Request.");

  let community = await Community.findById(req.params.id);
  if (!community) return res.status(404).send("Community not found.");

  let joinedCommunities = [];

  user.joined.forEach((community) => {
    joinedCommunities.push(community.toString());
  });

  if (joinedCommunities.indexOf(community._id.toString() < 0)) {
    if (community.privacy === "public") {
      user.joined.push(community._id);
      community.members.push(user._id);
      community.membersCount += 1;
    } else {
      community.pendingMembers.push({
        user: user._id,
        message: req.body.message,
      });
      user.pendingCommunities.push({
        user: community._id,
        message: req.body.message,
      });
      await community.save();
      await user.save();
      return res.send("Request has been sent!");
    }
  }

  await community.save();
  await user.save();

  return res.send(community);
});

router.post("/:id/leave", auth, async (req, res) => {
  let user = await User.findById(req.user._id);
  if (!user) return res.status(400).send("Bad Request.");

  let community = await Community.findById(req.params.id);
  if (!community) return res.status(404).send("Community not found.");

  let joinedCommunities = [];

  user.joined.forEach((community) => {
    joinedCommunities.push(community.toString());
  });

  if (joinedCommunities.indexOf(community._id.toString()) >= 0) {
    user.joined.splice(user.joined.indexOf(community._id.toString()), 1);
    community.members.splice(community.members.indexOf(user._id.toString()), 1);
    community.membersCount -= 1;
  }

  await user.save();
  await community.save();

  return res.send(community);
});

router.get("/:username/pending", auth, isAdmin, async (req, res) => {
  let community = await Community.findOne({
    username: req.params.username,
  })
    .select("pendingMembers")
    .populate({ path: "pendingMembers.user", model: "User" });

  if (community.pendingMembers) {
    return res.send(community.pendingMembers);
  } else {
    return res.send([]);
  }
});

router.post("/:username/pending/", auth, isAdmin, async (req, res) => {
  let user = await User.findById(req.body.userId);

  let community = await Community.findOne({ username: req.params.username });

  let answer = req.body.answer;

  if (answer === "accepted") {
    user.joined.push(community._id);
    community.members.push(user._id);
    community.membersCount += 1;
  }
  community.pendingMembers.splice(
    community.pendingMembers.includes(user._id.toString()),
    1
  );
  user.pendingCommunities.splice(
    user.pendingCommunities.includes(community._id.toString())
  );

  await community.save();
  await user.save();

  await res.send(community.pendingMembers || []);
});

router.get("/role/:username", auth, async (req, res) => {
  const community = await Community.findOne({ username: req.params.username });
  if (community.moderators && community.moderators.includes(req.user._id)) {
    res.send("admin");
  } else {
    res.send("user");
  }
});

router.get("/letter/:letter", async (req, res) => {
  const lowerCaseLetter = `^${req.params.letter.toLowerCase()}`;
  const upperCaseLetter = `^${req.params.letter.toUpperCase()}`;
  const lowerCaseRegex = new RegExp(lowerCaseLetter);
  const upperCaseRegex = new RegExp(upperCaseLetter);
  let lowerCaseCommunity = await Community.find({
    name: { $regex: lowerCaseRegex },
  });
  let upperCaseCommunity = await Community.find({
    name: { $regex: upperCaseRegex },
  });

  const communities = [...upperCaseCommunity, ...lowerCaseCommunity];

  res.send(communities);
});

/**
 * Flairs
 */

router.get("/flairs/:username", auth, async (req, res) => {
  const community = await Community.findOne({
    username: req.params.username,
  }).select("flairs");
  if (!community) return res.status(400).send("Community not found.");

  res.send(community.flairs);
});

router.post("/new/flair/:username", auth, isAdmin, async (req, res) => {
  let community = await Community.findOne({ username: req.params.username });
  if (!community) return res.status(400).send("Community not found.");

  const newFlair = req.body;

  if (community.flairs) {
    community.flairs = [newFlair, ...community.flairs];
  } else {
    community.flairs = [newFlairs];
  }

  await community.save();

  res.send(community);
});

router.delete("/flair/:username/:flairId", auth, isAdmin, async (req, res) => {
  let community = await Community.findOne({ username: req.params.username });

  community.flairs = community.flairs.filter(
    (flair) => flair.id !== req.params.flairId
  );

  await community.save();

  res.send(community.flairs);
});

router.get("/:username/banned", auth, isAdmin, async (req, res) => {
  let community = await Community.findOne({ username: req.params.username })
    .select("banned")
    .populate("banned.user")
    .populate("banned.reason");
  if (!community) return res.status(404).send("Community not found.");

  res.send(community.banned);
});

router.post("/:id/ban-user", auth, isAdmin, async (req, res) => {
  let user = await User.findOne({ username: req.body.username });
  if (!user) return res.status(404).send("User not found.");

  let community = await Community.findById(req.params.id);
  if (!community) return res.status(404).send("Community not found.");

  community.banned.forEach((bannedUser) => {
    if (bannedUser.user.equals(user._id)){
    }
  });

  if (community.members.includes(user._id)) {
    community.members = community.members.filter(
      (user) => !user.equals(user._id)
    );
    user.joined = user.joined.filter(
      (community) => !community.equals(user._id)
    );
    community.membersCount--;
  }

  const bannedUser = {
    user,
    ...req.body,
  };

  if (bannedUser.until && !bannedUser.permanent) {
    const now = Math.floor(Date.now() / 1000);
    const banDays = bannedUser.until * 86400;
    bannedUser.until = now + banDays;
  }

  if (community.banned && community.banned.length > 0) {
    community.banned = [bannedUser, ...community.banned];
  } else {
    community.banned = [bannedUser];
  }
  
  if(user.bannedFrom && !user.bannedFrom.includes(community._id)) {
    user.bannedFrom.push(community._id);
  }

  await community.save();
  await user.save();

  res.send(community.banned);
});

router.delete("/:id/unban-user", auth, isAdmin, async (req, res) => {
  let user = await User.findOne({ username: req.body.username });
  if (!user) return res.status(404).send("User not found.");

  let community = await Community.findById(req.params.id).populate("banned.rules").populate("banned.user");
  if (!community) return res.status(404).send("Community not found.");

  community.banned.forEach((user) => {
    if (!user.username === req.body.username)
      return res.status(400).send("Bad request.");
  });

  community.banned = community.banned.filter(
    (bannedUser) => !bannedUser.username === req.body.username
  );

  user.bannedFrom = user.bannedFrom.filter(c => c._id === community._id)

  await community.save();
  await user.save();

  res.send(community.banned);
});

router.put("/:username", auth, isAdmin, async (req, res) => {
  let community = await Community.findOne({ username: req.params.username });
  if (!community) return res.status(400).send("Bad request.");

  community = _.extend(community, req.body);

  await community.save();

  res.send(community);
});

router.delete("/:id", auth, isAdmin, async (req, res) => {
  let community = await Community.findByIdAndDelete(req.params.id);
  if (!community) res.status(400).send("Community not found");

  res.send(community);
});

module.exports = router;
